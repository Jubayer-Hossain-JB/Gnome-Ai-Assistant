import St from 'gi://St';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// --- Configuration ---
const BASE_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const USER_AGENT = 'GnomeAssistant/1.0';

let _httpSession;
const systemInstruction = {
    parts: [{
        text: 'Bismillahir Rahmanir Rahim. You are a highly polite and helpful AI Assistant named Juha, residing on a Fedora Linux machine. Your responses should be direct and concise, catering to your boss\'s preference. When presenting information that might be useful for copying, please enclose it within code tags (```text```). Express your sentiments through the use of emojis. Your demeanor should reflect the utmost courtesy and helpfulness, akin to a very sophisticated and obliging assistant.'
    }]
};

class GnomeAiAssistant extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._mainBox = null;
        this._chatHistoryBox = null;
        this._inputEntry = null;
        this._sendButton = null;
        this._scrollView = null;
        this._conversationHistory = [];
        this.settings = null;
        this.avatarIcon =null;

    }

    _initHttpClient() {
        if (!_httpSession) {
            _httpSession = new Soup.Session();
            _httpSession.set_timeout(30000);
            try {
                _httpSession.add_feature(new Soup.ContentDecoder());
            } catch (e) {
                console.warn(`${this.uuid}: Could not add ContentDecoder: ${e.message}`);
            }
        }
    }

    // This method decorates model responses
    _convertInlineMarkdownToPango(rawText) {
        if (!rawText) return '';

        // Escape any existing Pango/HTML special characters in the raw text.
        // This prevents user input from being rendered as bold
        // and ensures Pango tags are correctly interpreted.
        let pangoText = GLib.markup_escape_text(rawText, -1);

        // Convert inline code: `code` -> <span font_family="monospace" ...>code</span>
        // add spaces around the content inside the span for a slight padding effect,
        // as Pango spans don't have CSS-like padding.
        pangoText = pangoText.replace(/`(.+?)`/g, (match, codeContent) => {
            return `<span font_family="monospace" background="#343d4b" size="small"> ${codeContent.trim()} </span>`;
        });

        // 3. Convert bold: **text** -> <b>text</b>
        // The content (.+?) is already escaped, or it might be a <span> from step 2.
        // Pango allows <b> to contain <span>.
        pangoText = pangoText.replace(/\*\*(.+?)\*\*\n/g, (match, boldContent) => {
            return `<span size="${13*1024}" foreground="#0b62da" > <b>${boldContent}</b></span>`
        });
        pangoText = pangoText.replace(/\*\*(.+?)\*\*/g, (match, boldContent) => {
            return `<b>${boldContent}</b>`;
        });
        
        pangoText = pangoText.replace(/\*\s{3}/g, '<big><b>⦿  </b></big>'); //bullet points
        // *italic* -> <i>italic</i>
         pangoText = pangoText.replace(/\*(.+?)\*/g, (match, italicContent) => {
        //     if (!italicContent.startsWith(' ') && !italicContent.endsWith(' ')) { // Avoid conflict with **
                 return `<i>${italicContent}</i>`;
        //     }
        //     return match; // Return original if it looks like part of bold
        });


        return pangoText;
    } 

    // this method parses code blocks
    _parseBotMessage(fullText) {
        const segments = [];
        // Regex to find code blocks like ```lang\ncode\n``` or ```\ncode\n```
        // It captures: 2=language , 3=code content
        const codeBlockRegex = /\n*```(\w*)\n([\s\S]*?)\n(\s)*```\n*/g;
        let lastIndex = 0;
        let match;

        while ((match = codeBlockRegex.exec(fullText)) !== null) {
            // Text before the code block
            if (match.index > lastIndex) {
                segments.push({ type: 'text', content: fullText.substring(lastIndex, match.index) });
            }
            // The code block
            segments.push({
                type: 'code',
                language: match[1] || '', // Language tag (e.g., javascript, python)
                content: match[2].trimEnd(),  // The actual code, trim trailing newline often added by LLMs
            });
            lastIndex = codeBlockRegex.lastIndex;
        }

        // Text after the last code block (if any)
        if (lastIndex < fullText.length) {
            segments.push({ type: 'text', content: fullText.substring(lastIndex) });
        }

        // If no code blocks were found at all, and the text is not empty,
        // return the whole message as a single text segment.
        if (segments.length === 0 && fullText.length > 0) {
            segments.push({ type: 'text', content: fullText });
        }

        return segments;
    }

    // adds message from both parties to the UI
    _addMessageToChat(text, sender = 'Bot', isError = false) {
        if (!this._chatHistoryBox) return;

        const messageRow = new St.BoxLayout({
            style_class: 'message-row',
            x_expand: true,
        });

        let messageBubbleContent; // This will hold either a simple Label or a complex BoxLayout

        if (sender === 'Bot' && !isError) {
            messageBubbleContent = new St.BoxLayout({
                style_class: 'message-bubble ai-message-bubble', // Base + AI specific
                vertical: true, // Segments will be stacked vertically
            });

            const segments = this._parseBotMessage(text);
            segments.forEach(segment => {
                if (segment.type === 'code') {

                    const codeWrapper = new St.BoxLayout({
                        style_class: 'code-block-wrapper',
                        vertical: true,
                        //x_expand: true,
                    });

                    // Header for language and copy button
                    const header = new St.BoxLayout({ style_class: 'code-block-header', x_expand: true });
                    const langLabel = new St.Label({
                        text: segment.language || 'code',
                        style_class: 'code-language-label',
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    header.add_child(langLabel);

                    const headerSpacer = new St.Widget({ x_expand: true });
                    header.add_child(headerSpacer);

                    const copyButton = new St.Button({
                        style_class: 'copy-code-button',
                        can_focus: true,
                        label: _('Copy'),
                        height: 20 // Initially, or use an icon
                        // child: new St.Icon({ icon_name: 'edit-copy-symbolic', style_class: 'copy-code-icon' })
                    });
                    copyButton.connect('clicked', () => {
                        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, segment.content);

                        const originalLabel = copyButton.label;
                        copyButton.label = _('Copied!');
                        copyButton.set_reactive(false);

                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                            if (copyButton && copyButton.get_parent()) { // Check if button still exists because before timeout call back it can be closed
                                copyButton.label = originalLabel;
                                copyButton.set_reactive(true);
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                    header.add_child(copyButton);
                    codeWrapper.add_child(header);

                    // Code content using a ScrollView for potentially long code
                    const codeScrollView = new St.ScrollView({
                        style_class: 'code-block-scrollview',
                        x_expand: true,
                        y_expand: true,
                        vscrollbar_policy: St.PolicyType.AUTOMATIC,
                        hscrollbar_policy: St.PolicyType.AUTOMATIC,
        
                    });

                    const codeLabel = new St.Label({
                        text: segment.content,
                        style_class: 'code-block-content', // For monospaced font etc.
                    });
                    codeLabel.clutter_text.set_selectable(true);
                    codeLabel.clutter_text.set_line_wrap(false); // Disable line wrap for code
                    codeLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
                    
                    const codeContentBox = new St.BoxLayout({ x_expand: false, y_expand: true });
                    
                    // x_expand: false and y_expand: false on codeContentBox should make it size to codeLabel
                    codeContentBox.add_child(codeLabel);
                    codeScrollView.set_child(codeContentBox);
                    const naturalHeight = codeContentBox.height;

                    if (naturalHeight > 250) {
                        codeScrollView.height = 250; 
                    } else {
                        codeScrollView.height = naturalHeight+25;
                    }

                    codeWrapper.add_child(codeScrollView, { expand: true });
                    messageBubbleContent.add_child(codeWrapper);

                } else { // type === 'text'
                    const pangoFormattedContent = this._convertInlineMarkdownToPango(segment.content);
                    const textLabel = new St.Label(); // Create empty label first
                    textLabel.clutter_text.set_markup(pangoFormattedContent); // Use set_markup
                    textLabel.clutter_text.set_line_wrap(true);
                    textLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
                    textLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
                    textLabel.clutter_text.set_selectable(true);
                    messageBubbleContent.add_child(textLabel);
                }
            });
        } else { // User message, error, or simple system message
            messageBubbleContent = new St.Label({
                text: text,
                style_class: 'message-bubble',
                y_align: Clutter.ActorAlign.START,
            });
            messageBubbleContent.clutter_text.set_line_wrap(true);
            messageBubbleContent.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            messageBubbleContent.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

            if (isError) {
                messageBubbleContent.add_style_class_name('error-message-bubble');
            } else if (sender === 'User') {
                messageBubbleContent.add_style_class_name('user-message-bubble');
            } else { // System (non-error, non-bot with complex parsing)
                messageBubbleContent.add_style_class_name('ai-message-bubble'); // Or a dedicated 'system-message-bubble'
            }
        }

        // --- Assemble the messageRow ---
        const rowSpacer = new St.Widget({ x_expand: true }); // For left/right alignment of the bubble

        if (sender === 'User') {
            messageRow.add_child(rowSpacer); // Push bubble to the right
            messageRow.add_child(messageBubbleContent);
        } else { // Bot or System messages
            if (sender === 'Bot' && !isError) { // Add avatar only for actual bot messages
                if (this.avatarIcon) {
                    const aiIcon = new St.Icon({
                        gicon: this.avatarIcon,
                        style_class: 'ai-avatar-icon',
                        y_align: Clutter.ActorAlign.END, // Align icon to bottom of its row cell
                    });
                    messageRow.add_child(aiIcon);
                }
            }
            messageRow.add_child(messageBubbleContent);
            messageRow.add_child(rowSpacer); // Push bubble (and icon) to the left
        }
        this._chatHistoryBox.add_child(messageRow);

        // Auto-scroll logic (remains the same)
        if (this._scrollView) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
                if (this._scrollView && this._scrollView.vadjustment) {
                    let adjustment = this._scrollView.vadjustment;
                    adjustment.value = adjustment.upper - adjustment.page_size;
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        // Update internal conversation history (remains the same)
        if (sender === 'User') {
            this._conversationHistory.push({ role: 'user', parts: [{ text }] });
        } else if (!isError) {
            this._conversationHistory.push({ role: 'model', parts: [{ text }] });
        }

        let conversation_limit = 20
        if (this._conversationHistory.length > conversation_limit) { // Keep history limit
            this._conversationHistory.splice(0, this._conversationHistory.length - conversation_limit);
        }
    }

    async _sendMessage() {
        if (!this._inputEntry || !this._sendButton) return;
        const prompt = this._inputEntry.get_text();
        if (!prompt.trim()) return;
        // Retrieve settings
        const apiKey = this.settings.get_string('api-key');
        const modelName = this.settings.get_string('model-name');
        const temperature = this.settings.get_double('temperature');
        const maxOutputTokens = this.settings.get_int('max-output-tokens');

        if (!apiKey) {
            this._addMessageToChat(
                _("API Key not configured. Please set it in the extension preferences."),
                'System',
                true
            );
            return;
        }
        if (!modelName) {
            this._addMessageToChat(
                _("Model Name not configured. Please set it in the extension preferences."),
                'System',
                true
            );
            return;
        }

        this._addMessageToChat(prompt, 'User');
        this._inputEntry.set_text(''); 

        this._sendButton.set_reactive(false);
        const apiEndpoint = `${BASE_API_URL}${modelName}:generateContent?key=${apiKey}`;
        const payload = {
            systemInstruction,
            contents: [...this._conversationHistory],
        };

        const message = Soup.Message.new('POST', apiEndpoint);
        if (!message) {
            this._addMessageToChat("Failed to create HTTP message.", 'System', true);
            if (this._sendButton) this._sendButton.set_reactive(true);
            return;
        }
        message.set_request_body_from_bytes('application/json', GLib.Bytes.new(JSON.stringify(payload)));

        //message.request_headers.append('User-Agent', USER_AGENT);
        try {
            if (!_httpSession) this._initHttpClient();
            const bytes = await _httpSession.send_and_read_async(message, Gio.PRIORITY_DEFAULT, null);
            const responseStr = new TextDecoder().decode(bytes.get_data());
            const responseJson = JSON.parse(responseStr);

            if (message.get_status() === 200) {
                if (responseJson.candidates?.[0]?.content?.parts?.[0]?.text) {
                    this._addMessageToChat(responseJson.candidates[0].content.parts[0].text, 'Bot');
                } else if (responseJson.promptFeedback) {
                    this._addMessageToChat(`Blocked. Reason: ${responseJson.promptFeedback.blockReason || 'Unknown'}`, 'System', true);
                } else {
                    this._addMessageToChat("Empty/malformed API response.", 'System', true);
                }
            } else {
                const errorDetail = responseJson?.error?.message || responseStr;
                this._addMessageToChat(`API Error: ${message.get_status()} - ${errorDetail}`, 'System', true);
            }
        } catch (e) {
            this._addMessageToChat(`Error: can't connect to the server. Network problem`, 'System', true);
        } finally {
            if (this._sendButton) this._sendButton.set_reactive(true);
        }

    }
    _clearChatHistory() {
        if (this._chatHistoryBox) {
            this._chatHistoryBox.destroy_all_children();
        }
        this._conversationHistory = []; // Clear the internal API history

        
        this._addMessageToChat(_("How can I help you sir?"), "System");

        // If the input entry had focus, it might be good to refocus it
        if (this._inputEntry && !this._inputEntry.has_key_focus()) {
            this._inputEntry.grab_key_focus(); // Re-grabbing focus can be disruptive if not expected
        }
    }

    enable() {
        this._initHttpClient();
        this.settings = this.getSettings()
        this._indicator = new PanelMenu.Button(0.5, _('Google AI Assistant'), false);
        const avatarIconPath = GLib.build_filenamev([this.dir.get_path(), 'icons', 'avatar.svg']);
        if (GLib.file_test(avatarIconPath, GLib.FileTest.EXISTS)) {
            this.avatarIcon = Gio.FileIcon.new(Gio.File.new_for_path(avatarIconPath))             
        }
        const panelIconPath = GLib.build_filenamev([this.dir.get_path(), 'icons', 'icon.svg']);
        if (GLib.file_test(panelIconPath, GLib.FileTest.EXISTS)) {
            const panelIcon = new St.Icon({ gicon: Gio.FileIcon.new(Gio.File.new_for_path(panelIconPath)), style_class: 'system-status-icon' });
            this._indicator.add_child(panelIcon);
        }else{
            const panelIcon = new St.Icon({icon: 'image-x-generic-symbolic', style_class: 'system-status-icon' });
            this._indicator.add_child(panelIcon);
        }

        this._mainBox = new St.BoxLayout({ style_class: 'chat-popup-main-box', vertical: true, x_expand: true, y_expand: true });

        // --- Title Area with Clear Button ---
        const titleAreaBox = new St.BoxLayout({ style_class: 'chat-popup-title-area', x_expand: true });
        this._mainBox.add_child(titleAreaBox);

        const titleLabel = new St.Label({
            text: _('AI Assistant (Google AI Studio)'),
            style_class: 'chat-popup-title',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: true, // Allow title to take available space
        });
        // To center the title when there's a button on the right
        titleAreaBox.add_child(titleLabel);


        const clearChatButton = new St.Button({
            style_class: 'clear-chat-button icon-button', // Add 'icon-button' for generic icon button styling
            can_focus: true,
            // label: _("Clear"), 
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const trashIconPath = GLib.build_filenamev([this.dir.get_path(), 'icons', 'trash.svg']);
        if (GLib.file_test(trashIconPath, GLib.FileTest.EXISTS)) {
            const trashIcon = new St.Icon({ gicon: Gio.FileIcon.new(Gio.File.new_for_path(trashIconPath)), style_class: 'popup-menu-icon' });
            clearChatButton.add_child(trashIcon);
        }else{
            const trashIcon = new St.Icon({icon: 'trash-empty-symbolic', style_class: 'popup-menu-icon' });
            clearChatButton.add_child(trashIcon);
        }

        clearChatButton.connect('clicked', () => this._clearChatHistory());
        titleAreaBox.add_child(clearChatButton);

        this._scrollView = new St.ScrollView({
            style_class: 'chat-popup-scrollview vfade', // vfade adds a fade effect at top/bottom if scrollable
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true, y_expand: true, height: 350,
        });
        this._mainBox.add_child(this._scrollView);

        this._chatHistoryBox = new St.BoxLayout({ style_class: 'chat-history-box', vertical: true, x_expand: true });
        this._scrollView.set_child(this._chatHistoryBox);

        const inputBox = new St.BoxLayout({ style_class: 'chat-input-box', x_expand: true });
        this._mainBox.add_child(inputBox);

        this._inputEntry = new St.Entry({ hint_text: _('Ask me anything...'), can_focus: true, x_expand: true, style_class: 'chat-input-entry' });
        this._inputEntry.get_clutter_text().connect('activate', () => this._sendMessage());
        inputBox.add_child(this._inputEntry);

        this._sendButton = new St.Button({ style_class: 'chat-send-button', can_focus: true, label: '➤' });
        this._sendButton.connect('clicked', () => this._sendMessage());
        inputBox.add_child(this._sendButton);

        this._indicator.menu.box.add_child(this._mainBox);
        this._addMessageToChat("Hello! How are you Sir?", "System"); // "System" for initial prompt
        this._indicator.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
                    if (this._inputEntry) this._inputEntry.grab_key_focus();
                    return GLib.SOURCE_REMOVE;
                });
                //this._conversationHistory = [];
                //if (this._chatHistoryBox) this._chatHistoryBox.destroy_all_children();
            }
        });


        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this.settings = null;
        this._mainBox = null;
        this._chatHistoryBox = null;
        this._inputEntry = null;
        this._sendButton = null;
        this._scrollView = null;
        this.avatarIcon = null;
        this._conversationHistory = [];
    }
}

export default function (metadata) {
    return new GnomeAiAssistant(metadata);
}
