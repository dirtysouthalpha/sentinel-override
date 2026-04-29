# SentinelAgent Full-Featured Guide

Complete documentation for all advanced features in the enhanced UI.

---

## 🎯 Quick Start

### Installation
1. Rename `popup.html.FULL_FEATURED` → `popup.html`
2. Rename `popup-full.js` → `popup.js`  
3. Rename `background.js.FIXED` → `background.js` (if not done)
4. Reload extension in Chrome

### First Use
1. Click ⚙️ Settings
2. Add API Key (required)
3. Add API Endpoint (optional)
4. Choose Export Format
5. Click Save Settings

---

## 🌓 Dark Mode Toggle

**Location:** Header (moon icon)

### Features
- Automatic detection of system preference
- Persistent across sessions
- Smooth transitions
- Works with all features

### Keyboard Shortcut
- `Cmd+Shift+T` (Mac)
- `Ctrl+Shift+T` (Windows/Linux)

### How It Works
```
Light Mode → Click Moon → Dark Mode
Dark Mode → Click Moon → Light Mode
```

---

## 🎨 Theme Customization

**Location:** Header (palette icon) → Full Customization

### Quick Presets
- ☀️ **Light** - Clean white theme
- 🌙 **Dark** - Dark gray theme
- 🔵 **Blue** - Blue-tinted theme
- 🟣 **Purple** - Purple accent colors
- 🟢 **Green** - Green accent colors

### Custom Colors
Click preset → Customize colors individually:
1. **Primary Color** - Button accents, highlights
2. **Background** - Main panel color
3. **Text Color** - Main text color

### Apply & Save
Click "Apply Theme" to save custom colors for future sessions.

---

## 🔍 Message Search

**Location:** Toolbar search box

### Features
- Real-time search filtering
- Match counter shows results
- Highlights matching messages
- Case-insensitive search

### Usage
```
Type in search box → Matching messages highlight
Clear search box → Highlighting clears
```

### Example Searches
- `error` - Find error messages
- `api` - Find API-related discussions
- `success` - Find successful completions

---

## 👁️ Markdown Preview

**Location:** Toolbar "Preview" button

### Features
- Live preview of what you're typing
- Shows formatted markdown
- Real-time updates
- Side-by-side view

### When to Use
- Check formatting before sending
- Verify links work correctly
- Preview code blocks
- Ensure lists/tables render properly

### Keyboard
- Click button to toggle preview
- Preview appears on right side
- Still shows while typing

---

## 📎 File Attachments

**Location:** Toolbar "Attach" button

### Supported Files
- Text files (.txt)
- Markdown (.md)
- JSON (.json)
- Code files (.py, .js, etc.)
- Images (.png, .jpg, etc.)
- PDFs (.pdf)

### How to Attach
1. Click 📎 Attach button
2. Select one or more files
3. Files appear in preview area
4. Files sent with next message

### Remove Attachments
- Click ✕ next to filename to remove
- Clear all by deleting message

---

## 💾 Conversation Export

**Location:** Toolbar "Export" button

### Export Formats

#### Markdown (.md)
```markdown
### 👤 You
Your message here

---

### 🤖 Agent
Agent response here
```

#### JSON (.json)
```json
[
  {
    "role": "user",
    "text": "Your message"
  },
  {
    "role": "assistant",
    "text": "Response"
  }
]
```

#### Plain Text (.txt)
```
[USER]
Your message

---

[ASSISTANT]
Response
```

### Usage
1. Click 💾 Export button
2. Choose format in Settings
3. File downloads automatically
4. Timestamp added to filename

### File Naming
- Format: `conversation-{TIMESTAMP}.{ext}`
- Example: `conversation-1713700000000.md`

---

## 🎤 Voice Input

**Location:** Input area (microphone icon)

### Features
- Click to start listening
- Speaks recognized text
- Shows "Listening" state
- Works offline
- Continuous mode support

### How to Use
1. Click 🎤 microphone button
2. Speak clearly into microphone
3. Release or click again to stop
4. Text appears in input box

### Tips
- Speak naturally and clearly
- Works best in quiet environments
- Automatic punctuation available
- Supports multiple languages (settings)

### Supported Languages
- English (US, UK, AU, etc.)
- Spanish, French, German, Italian
- Japanese, Chinese, Korean
- Portuguese, Russian, and more

---

## ⌨️ Command Palette

**Location:** Header (terminal icon) or `Cmd+K`

### Keyboard Shortcuts
- `Cmd+K` (Mac) / `Ctrl+K` (Windows) - Open palette
- `↓↑` - Navigate commands
- `Enter` - Execute selected
- `Esc` - Close palette

### Available Commands

| Command | Shortcut | Action |
|---------|----------|--------|
| New Chat | `Cmd+N` | Start fresh conversation |
| Export | - | Download chat |
| Clear Search | - | Remove search highlights |
| Toggle Dark Mode | - | Switch theme |
| Open Settings | - | Configure API |
| Customize Theme | - | Custom colors |
| About | - | Extension info |

### Usage
```
Cmd+K → Type "export" → Enter → Downloads file
Cmd+K → Type "dark" → Enter → Toggles dark mode
Cmd+K → Type "clear" → Enter → Clears search
```

---

## 💻 Code Block Features

### Copy Button
Every code block has a "Copy" button:
1. Click 📋 Copy next to code
2. Code copied to clipboard
3. Button shows ✓ for 2 seconds

### Language Detection
```python
# Language shows above code block
```

### Example
````markdown
```python
def hello():
    print("Hello, World!")
```
````
↓ (renders as)
```
[ python ]
[📋 Copy]
def hello():
    print("Hello, World!")
```

---

## ⌨️ All Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `Cmd+N` | New chat |
| `Cmd+K` | Command palette |
| `Esc` | Close modals/palette |
| `↓↑` (in palette) | Navigate commands |

---

## ⚙️ Settings Panel

**Location:** Header gear icon or `Cmd+K` → Settings

### Configuration Options

#### API Endpoint
```
https://api.example.com/v1/chat/completions
```
- Required format: HTTPS URL
- Default: Venice AI endpoint
- Validate before saving

#### API Key
```
sk_... or your-api-key
```
- **Required** for operation
- Stored securely in chrome.storage
- Password input (hidden)
- Clear to reset

#### Model ID
```
gpt-4, claude-3, qwen3-vl-235b, etc.
```
- Default: qwen3-vl-235b
- Depends on your API provider
- Check provider docs

#### Export Format
- Markdown (.md)
- JSON (.json)
- Plain Text (.txt)

### Save & Validate
- Missing API key shows error
- Invalid URL format shows error
- Success message on save
- Settings persist across sessions

---

## 🌐 Status Messages

### Agent Status
```
🟢 Agent is starting...
🟢 Observing page...
🟢 Capturing screen...
🟢 Consulting AI...
🟢 Executing: click...
```

### User Feedback
```
✅ Settings saved
✅ Chat cleared
✅ Exported as MARKDOWN
❌ API key is required
❌ Invalid URL
```

---

## 🎯 Workflow Examples

### Example 1: Quick Research
```
1. Ask question
2. Review response
3. Preview markdown (click Preview)
4. Export to markdown (Export button)
5. Use in document
```

### Example 2: Code Review
```
1. Attach code files (📎 Attach)
2. Ask for review
3. Copy code blocks (📋 Copy button)
4. Apply fixes locally
5. Export conversation (💾 Export)
```

### Example 3: Documentation
```
1. Set export format to Markdown
2. Have multiple conversations
3. Export each as .md file
4. Combine into knowledge base
5. Share with team
```

---

## 💡 Tips & Tricks

### Search Efficiently
- Use short keywords
- Search updates in real-time
- Highlighting shows all matches
- Clear to reset

### Preview Before Sending
- Always preview long messages
- Check link formats
- Verify code blocks
- See exactly what sends

### Voice Workflow
- Hands-free input while working
- Faster than typing for long messages
- Edit voice input before sending
- Use preview to verify accuracy

### Export Organization
- Export after important conversations
- Use JSON for data analysis
- Use Markdown for documentation
- Use TXT for plain text backup

### Theme for Comfort
- Dark mode for night work
- Light mode for daytime
- Custom themes for brand matching
- Save preferences (automatic)

---

## 🔧 Troubleshooting

### Voice Input Not Working
- Check microphone permissions
- Try different browser
- Clear browser cache
- Restart extension

### Search Not Finding Messages
- Search is case-insensitive
- Check spelling
- Try shorter keywords
- Spaces are literal

### Export Files Not Downloading
- Check browser download settings
- Try different export format
- Check file name conflicts
- Clear browser cache

### Theme Changes Not Saving
- Refresh page after applying
- Try clearing cache
- Check localStorage enabled
- Restart extension

### Preview Not Updating
- Click Preview button to toggle
- Check markdown syntax
- Try simpler markdown first
- Report issues to developer

---

## 🚀 Pro Tips

1. **Command Palette Mastery**
   - Memorize `Cmd+K` shortcut
   - Type partial command names
   - Use for quick navigation

2. **Export Strategy**
   - Regular exports backup conversations
   - JSON export for data processing
   - Markdown export for sharing
   - Create archive folder

3. **Theme for Productivity**
   - Dark mode reduces eye strain
   - Light mode better for screenshots
   - Custom themes match branding
   - Quick toggle in header

4. **Search Techniques**
   - Search by error type
   - Search by topic
   - Search by command type
   - Combine with export

5. **Voice Efficiency**
   - Dictate while hands busy
   - Faster for long responses
   - Preview before sending
   - Combine with typing

---

## 📱 Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 90+ | ✅ Full | Recommended |
| Edge 90+ | ✅ Full | Chromium-based |
| Brave | ✅ Full | Chromium-based |
| Opera | ✅ Full | Chromium-based |
| Firefox | ❌ No | Different API |
| Safari | ❌ No | WebKit-based |

---

## 📊 Feature Checklist

- ✅ Dark Mode Toggle
- ✅ Theme Customization (5 presets + custom)
- ✅ Message Search
- ✅ Markdown Preview
- ✅ File Attachments
- ✅ Conversation Export (3 formats)
- ✅ Code Copy Buttons
- ✅ Voice Input (with speech recognition)
- ✅ Command Palette
- ✅ Keyboard Shortcuts
- ✅ Toast Notifications
- ✅ Settings Panel
- ✅ Chat History
- ✅ Typing Indicators
- ✅ Professional UI
- ✅ Responsive Design

---

## 📝 Version History

### v2.0 (Full-Featured)
- Added dark mode toggle
- Added theme customization
- Added message search
- Added markdown preview
- Added file attachments
- Added conversation export
- Added code copy buttons
- Added voice input
- Added command palette
- Added keyboard shortcuts
- Updated UI design
- Better mobile support

### v1.0 (Initial)
- Basic chat interface
- Settings panel
- Message display
- Code highlighting

---

## 🤝 Support

### Report Issues
- Check browser console (F12)
- Try clearing cache
- Reload extension
- Contact support with error

### Suggest Features
- Use command palette (Cmd+K)
- Check existing features
- Feature requests welcome
- Feedback appreciated

---

## 📄 License & Terms

SentinelAgent - AI-powered browser automation
© 2024 - All rights reserved

---

## ✨ What's Next?

Potential future features:
- Conversation threads
- Collaborative mode
- Cloud sync
- Mobile app
- API integration
- Plugin system
- Custom prompts
- Automation workflows

---

**Version:** 2.0  
**Last Updated:** 2024  
**Status:** Fully Featured & Stable
