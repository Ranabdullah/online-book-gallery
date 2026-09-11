#!/usr/bin/env python3
"""
Athenaeum - Automated Backend Server
- Serves the static web gallery and reader
- Auto-saves book metadata & cover edits directly to data/books.json and covers/
- Auto-commits and pushes changes to GitHub repository
"""

import http.server
import socketserver
import os
import json
import base64
import subprocess
import urllib.request
import re

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, 'data', 'books.json')
COVERS_DIR = os.path.join(BASE_DIR, 'covers')

os.makedirs(COVERS_DIR, exist_ok=True)

class AthenaeumHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/status':
            self.send_json({'isBackend': True, 'repo': 'online-book-gallery', 'port': PORT})
            return
        return super().do_GET()

    def do_POST(self):
        if self.path == '/api/save-override':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                result = self.save_override_to_backend(data)
                self.send_json({'success': True, 'updated': result})
            except Exception as e:
                self.send_json({'success': False, 'error': str(e)}, status=500)
            return

        if self.path == '/api/sync-all':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(body)
                overrides = data.get('overrides', {})
                results = []
                for book_id, item in overrides.items():
                    res = self.save_override_to_backend(item)
                    results.append(res)
                self.send_json({'success': True, 'count': len(results)})
            except Exception as e:
                self.send_json({'success': False, 'error': str(e)}, status=500)
            return

        self.send_json({'error': 'Endpoint not found'}, status=404)

    def save_override_to_backend(self, item):
        book_id = item.get('id')
        if not book_id:
            raise ValueError('Missing book ID')

        # 1. Handle cover image persistence to disk
        cover_val = item.get('cover')
        cover_path_for_json = None

        if cover_val and cover_val.startswith('data:image'):
            # Save base64 image directly to covers/{book_id}.jpg
            match = re.search(r'base64,(.+)$', cover_val)
            if match:
                b64_data = match.group(1)
                img_bytes = base64.b64decode(b64_data)
                target_filename = f'{book_id}.jpg'
                target_path = os.path.join(COVERS_DIR, target_filename)
                with open(target_path, 'wb') as f:
                    f.write(img_bytes)
                cover_path_for_json = f'covers/{target_filename}'
        elif cover_val and (cover_val.startswith('http://') or cover_val.startswith('https://')):
            # Download remote URL and cache locally in covers/
            try:
                req = urllib.request.Request(cover_val, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    img_bytes = resp.read()
                    target_filename = f'{book_id}.jpg'
                    target_path = os.path.join(COVERS_DIR, target_filename)
                    with open(target_path, 'wb') as f:
                        f.write(img_bytes)
                    cover_path_for_json = f'covers/{target_filename}'
            except Exception as e:
                print(f'Warning: could not download remote cover {cover_val}: {e}')
                cover_path_for_json = cover_val
        elif cover_val:
            cover_path_for_json = cover_val

        # 2. Update data/books.json on disk
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            books = json.load(f)

        found = False
        for b in books:
            if b.get('id') == book_id:
                if 'title' in item and item['title']: b['title'] = item['title']
                if 'author' in item and item['author']: b['author'] = item['author']
                if 'category' in item and item['category']: b['category'] = item['category']
                if cover_path_for_json: b['cover'] = cover_path_for_json
                found = True
                break

        if not found and item.get('isUserAdded'):
            books.insert(0, {
                'id': book_id,
                'title': item.get('title', 'Untitled'),
                'author': item.get('author', 'Unknown'),
                'category': item.get('category', 'Other'),
                'format': item.get('format', 'EPUB'),
                'sizeMB': item.get('sizeMB', 1.0),
                'cover': cover_path_for_json or 'covers/default.jpg',
                'isHosted': False,
                'file': item.get('file', '')
            })

        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(books, f, indent=2, ensure_ascii=False)

        # 3. Optional auto-commit to git
        if item.get('autoCommit', True):
            try:
                msg = f'feat: auto-sync updates for {item.get("title", book_id)}'
                target_cover = os.path.join(COVERS_DIR, f'{book_id}.jpg')
                files_to_add = [DATA_FILE]
                if os.path.exists(target_cover):
                    files_to_add.append(target_cover)
                subprocess.run(['git', 'add'] + files_to_add, cwd=BASE_DIR, capture_output=True)
                subprocess.run(['git', 'commit', '-m', msg], cwd=BASE_DIR, capture_output=True)
                subprocess.Popen(['git', 'push', 'origin', 'main'], cwd=BASE_DIR)
            except Exception as git_err:
                print('Git auto-commit notice:', git_err)

        return {'id': book_id, 'cover': cover_path_for_json}

    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    with socketserver.TCPServer(('', PORT), AthenaeumHandler) as httpd:
        print(f'Athenaeum Backend Server active at http://localhost:{PORT}')
        httpd.serve_forever()
