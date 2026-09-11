# 📖 Athenaeum — Cloud Book Gallery & Fast Reader

> A pristine, high-speed online book gallery and reader for EPUB, PDF, and digital literature. Access your entire library anywhere without tablet lag.

[![Live Demo](https://img.shields.io/badge/Live_Demo-GitHub_Pages-2563eb?style=for-the-badge&logo=github)](https://ranabdullah.github.io/online-book-gallery/)
[![Books Catalog](https://img.shields.io/badge/Library-480%2B_Books-success?style=for-the-badge)](https://ranabdullah.github.io/online-book-gallery/)
[![Formats](https://img.shields.io/badge/Formats-EPUB_%7C_PDF-orange?style=for-the-badge)](https://ranabdullah.github.io/online-book-gallery/)

---

## ✨ Features

- **⚡ Blazing-Fast Readers**:
  - **EPUB Engine** (`ePub.js`): Virtualized page rendering, responsive flow, custom font sizing (A- / A+), font family adjustments, chapter navigation (Table of Contents), and touch swipe gestures for tablets.
  - **PDF Engine** (`PDF.js`): Canvas rendering, zoom controls, outline navigation, and jump-to-page.
  - **Reading Position Memory**: Auto-saves your reading position in `localStorage` so you can pick up exactly where you left off.
- **🎨 Clean White Aesthetic**:
  - Modern, minimalist layout inspired by Apple Books and Linear.
  - High contrast, crisp borders, and subtle elevation shadows.
  - Reader color themes: **Clean White**, **Warm Paper (Sepia)**, and **Night Dark**.
- **📚 Curated Categories**:
  - *Classics & Literature* (Shakespeare, Tolstoy, Dostoevsky, Austen, Dickens, Hugo, Melville...)
  - *Fantasy & Adventure* (J. K. Rowling, Andrzej Sapkowski / Witcher, Tolkien, George R. R. Martin...)
  - *Fiction & Modern Novels* (Haruki Murakami, Kazuo Ishiguro, Stephen King, Albert Camus...)
  - *Philosophy & Psychology* (Sigmund Freud, Nietzsche, Schopenhauer, Plato, Marcus Aurelius...)
  - *Sci-Fi & Dystopian* (George Orwell, Philip K. Dick, Orson Scott Card, Ray Bradbury...)
  - *Art, Drawing & Animation* (Preston Blair, Andrew Loomis, Dan Gheno, Character Drawing...)
  - *Science & Non-Fiction* (DK Eyewitness Series, Smithsonian, Economics, Evolution...)
  - *Mythology & Folklore* (Norse, Egyptian, Greek, Celtic, Bulfinch...)
  - *Personal Growth & Finance* (James Clear, Robert Kiyosaki, Robin Sharma...)
- **💡 Book Recommendation Board**:
  - Anyone can recommend a book title and author to add to the reading list.
  - Notes, category tags, and recommender attribution.
  - 1-click **"Copy List"** to export recommendations anywhere.
- **📱 Tablet & Mobile Friendly**:
  - Fast touch swipe gestures to turn pages.
  - **"Open File"** feature: select and read any EPUB or PDF directly from your tablet storage instantly.

---

## 🚀 Live Shareable Link

- **Public Gallery & Reader**: [https://ranabdullah.github.io/online-book-gallery/](https://ranabdullah.github.io/online-book-gallery/)
- **GitHub Repository**: [https://github.com/Ranabdullah/online-book-gallery](https://github.com/Ranabdullah/online-book-gallery)

---

## 🛠️ Project Structure

```
online-book-gallery/
├── index.html              # Main gallery application
├── reader.html             # High-speed EPUB & PDF reader
├── css/
│   ├── style.css           # Clean white design system
│   └── reader.css          # Distraction-free reader styles & themes
├── js/
│   ├── app.js              # Gallery logic, search, category filter, favorites
│   ├── reader.js           # Reader controller (ePub.js & PDF.js)
│   ├── recommendations.js  # Recommendation submission & wishlist system
│   └── vendor/             # Local offline vendor libraries (ePub.js, PDF.js, JSZip)
├── data/
│   └── books.json          # Complete book catalog metadata
├── covers/                 # High-resolution optimized book covers
├── books/                  # E-book files ready for instant online reading
└── scripts/
    ├── build_catalog.py    # Catalog processing & cover extraction pipeline
    └── deploy.py           # GitHub Pages deployment automation
```

---

## 💻 Local Development

To run locally:
```bash
python -m http.server 8080
```
Open `http://localhost:8080` in your tablet or desktop browser.
