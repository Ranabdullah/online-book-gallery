import os, re, json, shutil, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE_DIR = r'F:\AntiGravity\Apps Data\online-book-gallery'
DATA_FILE = os.path.join(BASE_DIR, 'data', 'books.json')
BOOKS_DIR = os.path.join(BASE_DIR, 'books')
SOURCE_DIR = r'K:\Books\Upload'
SKIP_DIRS = {'System Volume Information', 'LOST.DIR'}

with open(DATA_FILE, 'r', encoding='utf-8') as f:
    books = json.load(f)

existing_titles = set(re.sub(r'[^a-z0-9]', '', b['title'].lower()) for b in books)
max_id_num = max(int(re.search(r'\d+', b['id']).group()) for b in books if re.search(r'\d+', b['id']))

def get_next_id():
    global max_id_num
    max_id_num += 1
    return f"book_{max_id_num:04d}"

def clean_title(raw):
    name = re.sub(r'\s*-\s*(19|20)\d{2}\s*$', '', raw)
    name = re.sub(r'^\d+[_\s]+', '', name)
    name = name.replace('_', ' ').strip()
    return name

# Best-effort category guesses by author-folder keyword.
CATEGORY_MAP = {
    'classics': ['Camus', 'Aldous Huxley', 'Alexandre Dumas', 'Anna Sewell', 'Arthur Conan Doyle',
        'Bram Stoker', 'Charles Dickens', 'Charlotte Bronte', 'Emily Bronte', 'Cormac McCarthy',
        'Dante Alighieri', 'Daphne du Maurier', 'Dostoevsky', 'Flaubert', 'Franz Kafka',
        'George Eliot', 'Gustave Flaubert', 'Harper Lee', 'Hemingway', 'Henry James',
        'Herman Melville', 'Hermann Hesse', 'Homer', 'Honore de Balzac', 'Jane Austen',
        'Jonathan Swift', 'Joseph Conrad', 'Leo Tolstoy', 'Lewis Carroll', 'Margaret Mitchell',
        'Mark Twain', 'Mary Shelley', 'Miguel de Cervantes', 'Nathaniel Hawthorne', 'Oscar Wilde',
        'Sophocles', 'Thomas Hardy', 'Victor Hugo', 'Virginia Woolf', 'Voltaire',
        'Washington Irving', 'Wilkie Collins', 'William Makepeace Thackeray', 'John Milton',
        'James Joyce', 'F. Scott Fitzgerald', 'Evelyn Waugh', 'John Steinbeck', 'Fyodor Dostoevsky'],
    'fantasy': ['J. R. R. Tolkien', 'Ursula K. Le Guin', 'Terry Pratchett', 'J. K. Rowling',
        'George R. R. Martin', 'Robert Jordan', 'Steven Erikson', 'N. K. Jemisin', 'Eoin Colfer',
        'Rick Riordan', 'Christopher Paolini', 'Neil Gaiman', 'C. S. Lewis', 'L. Frank Baum',
        'Orson Scott Card', 'Neil Gaiman & Terry Pratchett'],
    'scifi': ['Isaac Asimov', 'Ray Bradbury', 'Philip K. Dick', 'Arthur C. Clarke',
        'Neal Stephenson', 'Douglas Adams', 'Frank Herbert', 'Suzanne Collins'],
    'philosophy': ['Friedrich Nietzsche', 'Arthur Schopenhauer', 'David Hume', 'Soren Kierkegaard',
        'Marcus Aurelius', 'Epictetus', 'Sigmund Freud', 'Carl Jung', 'Bertrand Russell',
        'Plato', 'Thomas Hobbes', 'St. Augustine'],
    'mythology': ['Thomas Bulfinch', 'Andrew Lang', 'Brothers Grimm', 'Lewis Spence',
        'Donald A. Mackenzie', 'E. M. Berens'],
    'growth': ['Robert Kiyosaki', 'James Clear', 'Jay Shetty', 'Eckhart Tolle', 'Robin Sharma',
        'Hector Garcia & Francesc Miralles', 'Joseph Murphy', 'Thomas J. Stanley'],
}
MAP_TO_LABEL = {
    'classics': 'Classics & Literature',
    'fantasy': 'Fantasy & Adventure',
    'scifi': 'Sci-Fi & Dystopian',
    'philosophy': 'Philosophy & Psychology',
    'mythology': 'Mythology & Folklore',
    'growth': 'Personal Growth & Finance',
}

def guess_category(author_folder):
    if not author_folder:
        return None
    for key, names in CATEGORY_MAP.items():
        if author_folder in names:
            return MAP_TO_LABEL[key]
    return None

new_entries = []
skipped_dupes = []
skipped_mobi = []

for root, dirs, files in os.walk(SOURCE_DIR):
    base = os.path.basename(root)
    if base in SKIP_DIRS:
        dirs[:] = []
        continue
    rel = os.path.relpath(root, SOURCE_DIR)
    author_from_folder = None if rel == '.' else rel.split(os.sep)[0]

    for fname in files:
        ext = os.path.splitext(fname)[1].lower()
        name_no_ext = os.path.splitext(fname)[0]

        if ext == '.mobi':
            skipped_mobi.append(os.path.join(rel, fname))
            continue
        if ext not in ('.epub', '.pdf'):
            continue

        author = author_from_folder
        title = name_no_ext
        category = guess_category(author_from_folder)

        if not author:
            m = re.match(r'^(.*?)\s*-\s*([A-Z][a-z]+(?:\s[A-Z][a-zA-Z.]+){1,3})$', name_no_ext)
            m2 = re.match(r'^([A-Za-z.]+ [A-Z]\.?)\s*-\s*(.+?)\s*-\s*(19|20)\d{2}$', name_no_ext)
            if m:
                title, author = m.group(1).strip(), m.group(2).strip()
            elif m2:
                author, title = m2.group(1).strip(), m2.group(2).strip()
                category = category or 'Science & Non-Fiction'
            else:
                author = 'Unknown'
                title = clean_title(name_no_ext)
        else:
            title = clean_title(title)

        title_key = re.sub(r'[^a-z0-9]', '', title.lower())
        if title_key in existing_titles:
            skipped_dupes.append(os.path.join(rel, fname))
            continue
        existing_titles.add(title_key)

        new_id = get_next_id()
        dest_filename = f"{new_id}{ext}"
        src_path = os.path.join(root, fname)
        dest_path = os.path.join(BOOKS_DIR, dest_filename)
        if os.path.exists(dest_path):
            os.chmod(dest_path, 0o666)
        shutil.copy2(src_path, dest_path)
        os.chmod(dest_path, 0o666)
        size_mb = round(os.path.getsize(dest_path) / (1024 * 1024), 2)

        new_entries.append({
            "id": new_id,
            "title": title,
            "author": author,
            "category": category or "Uncategorized",
            "format": ext[1:].upper(),
            "sizeMB": size_mb,
            "cover": "covers/default.jpg",
            "isHosted": True,
            "file": f"books/{dest_filename}",
            "originalName": fname,
            "needsFix": category is None
        })
        print(f"[ADDED] {new_id}: '{title}' by {author} -> {dest_filename} ({size_mb} MB)")

books.extend(new_entries)
with open(DATA_FILE, 'w', encoding='utf-8') as f:
    json.dump(books, f, indent=2, ensure_ascii=False)

print(f"\n=== DONE ===")
print(f"Added: {len(new_entries)} new books")
print(f"Skipped (title already in catalog): {len(skipped_dupes)}")
print(f"Skipped (.mobi, needs conversion first): {len(skipped_mobi)}")
needs_fix = sum(1 for b in new_entries if b['needsFix'])
print(f"Needs manual category review: {needs_fix}")

if skipped_mobi:
    print("\n.mobi files not imported:")
    for s in skipped_mobi:
        print(" -", s)
