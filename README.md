<p align="center">
  <img src="public/logo.png" alt="LISA Core" width="128">
</p>

# LISA Core Chrome Extension

**AI Memory Library** - Capture AI conversations from Claude, ChatGPT, Gemini & more!

![Version](https://img.shields.io/badge/version-0.49.7-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 🎯 What is LISA Core?

LISA (Linguistic Intelligence Semantic Anchors) compresses AI conversations into portable semantic tokens, saving up to 80% of tokens while preserving full meaning.

**The Problem:** Your AI conversations are trapped in silos. Different platforms, no portability, no backup.

**The Solution:** LISA extracts and compresses conversations into portable JSON files that work across ANY AI platform.

## ✨ Features

- 🔄 **9 Platform Support** - Claude, ChatGPT, Gemini, Grok, Mistral, DeepSeek, Copilot, Perplexity + Universal
- 📤 **One-Click Export** - Extract full conversations with a single click
- ✂️ **Selection Export** - Right-click to export selected text snippets
- 🗜️ **Semantic Compression** - 4:1 to 5:1 compression ratio
- 💾 **Floating Save Button** - Quick access LISA-V and Raw JSON exports
- 📋 **LISA-V Format** - Verbatim conversation capture with code separation
- 📸 **Auto-Snapshots** - Automatically save when closing AI chat tabs
- 🔐 **LISA Hash** - Cryptographic integrity verification (Premium)
- ☁️ **Web App Sync** - Connect with LISA Core Web App
- 📜 **Version History** - Git-style tracking of conversation evolution
- 🔗 **Hash Chain** - SHA-256 integrity verification for each snapshot
- ⏪ **Time Machine** - View and restore previous versions

## 🚀 Installation

### Chrome Web Store (Recommended)

[**Install from Chrome Web Store**](https://chromewebstore.google.com/detail/lisa-core-ai-memory-libra/dmgnookddagimdcggdlbjmaobmoofhbj)

### Developer Mode

1. Download this repository (Code → Download ZIP)
2. Extract the ZIP file
3. Open Chrome and go to `chrome://extensions/`
4. Enable **Developer mode** (toggle in top-right)
5. Click **Load unpacked**
6. Select the extracted folder

## 📖 How to Use

### Export Full Conversation
1. Open any supported AI platform (Claude, ChatGPT, etc.)
2. Click the LISA extension icon
3. Click **Export Conversation**
4. Save the JSON file

### Floating Button (LISA-V & Raw JSON)
1. Look for the floating 💾 LISA button on any AI chat
2. Click to choose **Save Raw JSON** or **Save LISA-V**
3. Access saved conversations in the extension library

### Export Selected Text
1. Select any text on a page
2. Right-click → **Export Selection to LISA Core**
3. Save the JSON snippet

### Use Your LISA JSON
1. Open any AI platform
2. Upload your LISA JSON file
3. Say: *"Read this LISA JSON and continue our conversation"*
4. The AI will understand your full context!

## 💰 Pricing

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0 | 5 exports/day, 5 LISA-V/day, 5 Raw JSON/day, basic compression |
| **Premium** | See pricing | Unlimited exports, LISA Hash, priority support |

## 🔗 Links

- **Chrome Web Store:** [Install LISA Core](https://chromewebstore.google.com/detail/lisa-core-ai-memory-libra/dmgnookddagimdcggdlbjmaobmoofhbj)
- **Web App:** [Lisa Core - AI Memory Library](https://lisa-web-backend-production.up.railway.app/landing)
- **Company:** [SAT-CHAIN LLC](https://sat-chain.com)

## 📁 Project Structure
```
lisa-extension/
├── manifest.json           # Extension configuration
├── src/
│   ├── background/        # Service worker
│   │   └── service-worker.js
│   ├── content/           # Platform parsers
│   │   ├── claude-parser.js
│   │   ├── chatgpt-parser.js
│   │   ├── gemini-parser.js
│   │   ├── lisa-floating-button.js
│   │   ├── lisa-v-parser.js
│   │   └── ... (9 total)
│   └── popup/             # Extension UI
│       ├── popup.html
│       ├── popup.css
│       └── popup.js
└── public/                # Icons
```

## 🛠️ Development
```bash
# Clone the repo
git clone https://github.com/AmarDaMoney/lisa-extension.git

# Load in Chrome
# 1. Go to chrome://extensions/
# 2. Enable Developer mode
# 3. Load unpacked → select the folder
```

## 📄 License

MIT License - Copyright (c) 2026 SAT-CHAIN LLC

---

Built with ❤️ by [Amar Dahmani](https://github.com/AmarDaMoney)
