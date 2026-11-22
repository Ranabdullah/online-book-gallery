#!/usr/bin/env python3
"""Generate and publish source-grounded summaries for hosted Athenaeum PDF/EPUB books.

Requires: requests, pypdf, beautifulsoup4. Runs inside GitHub Actions with a
private GEMINI_API_KEY. Only samples verified book source text, not filenames.
"""
import argparse
import datetime as dt
import io
import json
import os
import pathlib
import re
import sys
import time
import urllib.parse
import zipfile

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "generated-summaries"
REPORT = ROOT / "data" / "generated-summaries-status.json"
FAILURES = ROOT / "data" / "generated-summaries-failures.json"
MAX_FILE = 80 * 1024 * 1024
MAX_EXCERPT = 26000
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Athenaeum-source-summary-build/1.0"})


def sampling_positions(n, count=14):
    if n < 1:
        return []
    if n <= count:
        return list(range(n))
    return sorted({round((n - 1) * i / (count - 1)) for i in range(count)})


def safe_source_file(book):
    path = str(book.get("file") or "")
    if not re.fullmatch(r"books/[A-Za-z0-9_/-]+\.(?:pdf|epub)", path, re.I) or ".." in path:
        raise ValueError("Unsupported or unsafe book path")
    return path


def fetch_book(path):
    # Hosted books are public on the current GitHub origin. This runner does
    # not need to download the entire >3 GB repository.
    url = "https://raw.githubusercontent.com/Ranabdullah/online-book-gallery/main/" + urllib.parse.quote(path, safe="/")
    with SESSION.get(url, timeout=(20, 120), stream=True) as res:
        res.raise_for_status()
        length = int(res.headers.get("content-length", "0") or 0)
        if length > MAX_FILE:
            raise ValueError("Book too large for scheduled extraction")
        out = io.BytesIO()
        for part in res.iter_content(chunk_size=1024 * 1024):
            out.write(part)
            if out.tell() > MAX_FILE:
                raise ValueError("Book exceeds scheduled extraction limit")
        return out.getvalue()


def extract_pdf(data):
    pdf = PdfReader(io.BytesIO(data), strict=False)
    count = len(pdf.pages)
    samples = []
    total = 0
    for idx in sampling_positions(count):
        try:
            text = " ".join((pdf.pages[idx].extract_text() or "").split())
        except Exception:
            continue
        if len(text) < 80:
            continue
        excerpt = text[: min(3100, MAX_EXCERPT - total)]
        samples.append(f"PDF page {idx + 1} of {count}:\n{excerpt}")
        total += len(excerpt)
        if total >= MAX_EXCERPT:
            break
    if total < 400:
        raise ValueError("Insufficient extractable text (possibly scanned PDF)")
    return "\n\n".join(samples), f"{len(samples)} sampled pages of {count} PDF pages", len(samples)


def extract_epub(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = set(z.namelist())
        if "META-INF/container.xml" not in names:
            raise ValueError("Not a valid EPUB: container.xml missing")
        import xml.etree.ElementTree as ET
        container = ET.fromstring(z.read("META-INF/container.xml"))
        rootfile = next((n.attrib.get("full-path") for n in container.iter() if n.tag.endswith("rootfile")), None)
        if not rootfile or rootfile not in names:
            raise ValueError("Not a valid EPUB: OPF missing")
        opf = ET.fromstring(z.read(rootfile))
        manifest = {n.attrib.get("id"): n.attrib.get("href") for n in opf.iter() if n.tag.endswith("item")}
        ids = [n.attrib.get("idref") for n in opf.iter() if n.tag.endswith("itemref")]
        directory = pathlib.PurePosixPath(rootfile).parent
        excerpts = []
        total = 0
        for idx in sampling_positions(len(ids)):
            href = manifest.get(ids[idx]) or ""
            if not href or href.startswith(("http:", "https:", "data:")):
                continue
            # Normalize paths without accepting archive traversal.
            pieces = []
            for piece in str(directory / urllib.parse.unquote(href.split("#")[0].split("?")[0])).split("/"):
                if piece == "..":
                    if pieces:
                        pieces.pop()
                elif piece and piece != ".":
                    pieces.append(piece)
            name = "/".join(pieces)
            if name not in names:
                continue
            body = BeautifulSoup(z.read(name), "html.parser")
            for tag in body(["style", "script", "nav", "svg", "header", "footer"]):
                tag.decompose()
            text = " ".join(body.get_text(" ", strip=True).split())
            if len(text) < 80:
                continue
            excerpt = text[: min(3100, MAX_EXCERPT - total)]
            excerpts.append(f"EPUB spine section {idx+1} of {len(ids)}:\n{excerpt}")
            total += len(excerpt)
            if total >= MAX_EXCERPT:
                break
    if total < 400:
        raise ValueError("Insufficient EPUB chapter text")
    return "\n\n".join(excerpts), f"{len(excerpts)} sampled sections of {len(ids)} EPUB spine sections", len(excerpts)


def gemini(book, excerpt, scope, model, api_key):
    prompt = (
        "TITLE: " + str(book.get("title") or "") + "\n"
        "CATALOG AUTHOR (not verified): " + str(book.get("author") or "") + "\n"
        "SOURCE SCOPE: " + scope + "\n\n"
        "ACTUAL SOURCE EXCERPTS:\n" + excerpt + "\n\n"
        "Return JSON with three keys: everyday, inDepth, dossier. "
        "dossier must be an object with: coreThesis (plain text), executiveOverview (plain text), "
        "sampledSectionBreakdown (array up to 4 objects with section, summary, themes [strings]), "
        "moralConclusions (array up to 5 evidenced interpretations), "
        "writingStyle (object with voice, tone, technique), "
        "grammar (object with syntax, diction), "
        "topics (array of up to 5 objects with topic and insight), "
        "concepts (array of up to 5 objects with concept and description). "
        "Keep those fields concise; omit unsupported topics instead of guessing. "
        "The breakdown must describe ONLY sampled sections, NEVER assert a complete chapter/act map. "
        "Everyday: about 180–250 words, plain language, 3–5 concrete takeaways. "
        "InDepth: about 400–650 words of advanced but readable analysis of themes, "
        "structure and style only if evidenced by excerpts, using actual provided "
        "PDF page or EPUB spine section markers. For non-narrative documents or forms, "
        "explain their actual content rather than inventing literary plots. "
        "Both analyses, executive overview and section descriptions must state explicitly that this is based on EXCERPTS ONLY, "
        "not a verified full-book analysis. Never fabricate quotations, scholarship, "
        "events, characters, chapter names, external research or page references."
    )
    response = SESSION.post(
        "https://generativelanguage.googleapis.com/v1beta/models/"
        + urllib.parse.quote(model, safe="-_.") + ":generateContent",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={
            "system_instruction": {"parts": [{"text": "You are a careful source-grounded book researcher. Use ONLY supplied excerpts. Return valid JSON."}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json", "maxOutputTokens": 5000},
        },
        timeout=115,
    )
    if response.status_code in (401, 403, 429):
        raise RuntimeError(f"FATAL_API_{response.status_code}: API key, model access or quota problem")
    response.raise_for_status()
    data = response.json()
    raw = "".join(p.get("text", "") for p in data.get("candidates", [{}])[0].get("content", {}).get("parts", []))
    parsed = json.loads(raw)
    a, b = parsed.get("everyday"), parsed.get("inDepth")
    if not isinstance(a, str) or len(a.strip()) < 160 or not isinstance(b, str) or len(b.strip()) < 320:
        raise ValueError("Gemini returned incomplete summaries")
    dossier = parsed.get("dossier") if isinstance(parsed.get("dossier"), dict) else {}
    return a.strip(), b.strip(), dossier


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--model", default=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"))
    args = parser.parse_args()
    limit = max(1, min(args.limit, 150))
    key = os.environ.get("GEMINI_API_KEY", "")
    if len(key) < 20:
        sys.exit("Missing GEMINI_API_KEY GitHub Actions secret. Generate a NEW key; do not reuse any key shared in chat.")
    books = json.loads((ROOT / "data/books.json").read_text(encoding="utf-8"))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = {"createdAt": dt.datetime.now(dt.timezone.utc).isoformat(), "model": args.model,
               "catalog": len(books), "successful": [], "failed": [], "skipped": 0}
    candidates = [b for b in books if b.get("isHosted") and not b.get("needsFix") and
                  not b.get("isExternal") and b.get("file") and
                  str(b["file"]).lower().endswith((".pdf", ".epub"))]
    # Work through newest GitHub catalog entries first. Private R2 book contents
    # must never be written to the publicly accessible summaries directory.
    candidates = list(reversed(candidates))
    try:
        failures = json.loads(FAILURES.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        failures = {}
    attempted = 0
    for book in candidates:
        destination = OUTPUT / (str(book.get("id") or "") + ".json")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{3,80}", str(book.get("id") or "")):
            results["failed"].append({"bookId": str(book.get("id", "")), "error": "Invalid catalog ID"})
            continue
        if destination.exists():
            try:
                existing = json.loads(destination.read_text(encoding="utf-8"))
                if existing.get("summaries", {}).get("everyday", {}).get("text") and existing.get("summaries", {}).get("inDepth", {}).get("text"):
                    results["skipped"] += 1
                    continue
            except (ValueError, OSError):
                pass
        failure = failures.get(book["id"]) or {}
        try:
            last = dt.datetime.fromisoformat(str(failure.get("lastAttempt") or ""))
            if last.tzinfo is None:
                last = last.replace(tzinfo=dt.timezone.utc)
            if dt.datetime.now(dt.timezone.utc) - last < dt.timedelta(days=7):
                results["skipped"] += 1
                continue
        except ValueError:
            pass
        if attempted >= limit:
            break
        attempted += 1
        try:
            path = safe_source_file(book)
            payload = fetch_book(path)
            excerpt, scope, sections = extract_pdf(payload) if path.lower().endswith(".pdf") else extract_epub(payload)
            everyday, in_depth, raw_dossier = gemini(book, excerpt, scope, args.model, key)
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            common = {"source": "actual-book-excerpts", "partial": True, "sections": sections,
                      "sourceScope": scope, "model": args.model, "createdAt": now}
            sections = raw_dossier.get("sampledSectionBreakdown") or []
            if not isinstance(sections, list):
                sections = []
            moral = raw_dossier.get("moralConclusions") or []
            if not isinstance(moral, list):
                moral = []
            style = raw_dossier.get("writingStyle") or {}
            grammar = raw_dossier.get("grammar") or {}
            topics = raw_dossier.get("topics") or []
            concepts = raw_dossier.get("concepts") or []
            if not isinstance(style, dict):
                style = {}
            if not isinstance(grammar, dict):
                grammar = {}
            if not isinstance(topics, list):
                topics = []
            if not isinstance(concepts, list):
                concepts = []
            overview = str(raw_dossier.get("executiveOverview") or "").strip()
            core = str(raw_dossier.get("coreThesis") or "").strip()
            dossier = {
                "sourceStatus": "excerpt_based",
                "isPlaceholder": False,
                "genre": book.get("category", "Uncategorized"),
                "difficultyLevel": "Not assessed",
                "readingTimeMinutes": None,
                "whatTheBookSays": {"coreThesis": core or overview or everyday[:250],
                                    "premise": "Summary based on sampled source excerpts only."},
                "comprehensiveSummary": {
                    "elevatorPitch": overview or everyday,
                    "acts": [
                        {"act": str(row.get("section") or "Sampled source section")[:200],
                         "chapters": "Sampled pages/sections only — not a complete breakdown",
                         "summary": str(row.get("summary") or "")[:1200],
                         "keyThemes": [str(x)[:100] for x in (row.get("themes") or [])[:5]]}
                        for row in sections[:4] if isinstance(row, dict) and row.get("summary")
                    ],
                    "moralConclusions": [str(x)[:500] for x in moral[:5] if isinstance(x, str)]
                },
                "writingStyle": {
                    "voice": str(style.get("voice") or "Not assessed from available excerpts"),
                    "tonalSpectrum": str(style.get("tone") or "Not assessed from available excerpts"),
                    "cinematicMontage": str(style.get("technique") or "Not assessed from available excerpts"),
                    "symbolism": {}
                },
                "grammarAndLinguisticCharacteristics": {
                    "grammaticalComplexityScore": "Not numerically assessed",
                    "syntaxArchitecture": str(grammar.get("syntax") or "Not assessed"),
                    "dictionProfile": str(grammar.get("diction") or "Not assessed"),
                    "neologismsAndPortmanteaus": "Not assessed"
                },
                "topicsDiscussed": [
                    {"topic": str(row.get("topic") or "")[:160],
                     "insight": str(row.get("insight") or "")[:600]}
                    for row in topics[:5] if isinstance(row, dict)
                ],
                "coreConcepts": [
                    {"concept": str(row.get("concept") or "")[:160],
                     "description": str(row.get("description") or "")[:600]}
                    for row in concepts[:5] if isinstance(row, dict)
                ],
                "difficultWordsGlossary": [],
                "discussionQuestions": []
            }
            result = {"bookId": book["id"], "title": book.get("title"), "author": book.get("author"),
                      "sourceScope": scope, "dossier": dossier,
                      "summaries": {"everyday": {**common, "text": everyday},
                                    "inDepth": {**common, "text": in_depth}}}
            destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            results["successful"].append(book["id"])
            failures.pop(book["id"], None)
            print(f"SAVED {book['id']}: {book.get('title', '')[:90]}", flush=True)
        except Exception as ex:
            message = str(ex)[:220]
            results["failed"].append({"bookId": book.get("id"), "title": book.get("title"), "error": message})
            if not message.startswith("FATAL_API_"):
                failures[book["id"]] = {"lastAttempt": dt.datetime.now(dt.timezone.utc).isoformat(),
                                        "error": message, "attempts": int(failures.get(book["id"], {}).get("attempts", 0)) + 1}
            print(f"SKIP {book.get('id')}: {message}", flush=True)
            if message.startswith("FATAL_API_"):
                break
        time.sleep(0.35)
    results["eligible"] = len(candidates)
    results["publishedTotal"] = len(list(OUTPUT.glob("*.json")))
    REPORT.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    FAILURES.write_text(json.dumps(failures, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in results.items() if k not in ("failed", "successful")}, indent=2))
    # An API authentication failure should make the workflow visibly fail rather than
    # misleading the user that all summaries were generated.
    if any(str(row["error"]).startswith("FATAL_API_") for row in results["failed"]):
        sys.exit("Gemini API error: check key permissions, model access and free-tier quota.")


if __name__ == "__main__":
    main()
