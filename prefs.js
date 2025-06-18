import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GnomeAIAssistantPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Store the settings object
        this.settings = this.getSettings();

        // Create a preferences page
        const page = new Adw.PreferencesPage();
        window.add(page); // Add page to the Gtk.Window passed by GNOME Shell

        // --- API Configuration Group ---
        const apiGroup = new Adw.PreferencesGroup({
            title: _('API Configuration'),
            description: _('Settings for connecting to the Google AI Studio API.'),
        });
        page.add(apiGroup);

        // API Key Row (Password Entry)
        const apiKeyRow = new Adw.PasswordEntryRow({
            title: _('API Key'),
            // text: this.settings.get_string('api-key'), // Bound below
            show_apply_button: true, // Shows a checkmark to apply
        });
        apiGroup.add(apiKeyRow);
        // Bind the 'text' property of apiKeyRow to the 'api-key' GSettings key
        this.settings.bind('api-key', apiKeyRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        // Model Name Row
        const modelNameRow = new Adw.EntryRow({
            title: _('Model Name'),
            // text: this.settings.get_string('model-name'), // Bound below
            show_apply_button: true,
        });
        apiGroup.add(modelNameRow);
        this.settings.bind('model-name', modelNameRow, 'text', Gio.SettingsBindFlags.DEFAULT);


        // --- Generation Parameters Group ---
        const generationGroup = new Adw.PreferencesGroup({
            title: _('Generation Parameters'),
            description: _('Control the behavior of the AI model.'),
        });
        page.add(generationGroup);

        // Temperature Row (SpinButton)
        const temperatureRow = new Adw.SpinRow({
            title: _('Temperature'),
            subtitle: _('0.0 (deterministic) to 1.0 (more random). Some models support up to 2.0.'),
            adjustment: new Gtk.Adjustment({
                lower: 0.0,
                upper: 2.0, // Max range, actual API might restrict per model
                step_increment: 0.1,
                page_increment: 0.1,
                // value: this.settings.get_double('temperature'), // Bound below
            }),
            digits: 1, // Number of decimal places
        });
        generationGroup.add(temperatureRow);
        this.settings.bind('temperature', temperatureRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Max Output Tokens Row (SpinButton)
        const maxTokensRow = new Adw.SpinRow({
            title: _('Max Output Tokens'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 8192, // Common upper limit for many models
                step_increment: 64,
                page_increment: 256,
                // value: this.settings.get_int('max-output-tokens'), // Bound below
            }),
            digits: 0, // Integer
        });
        generationGroup.add(maxTokensRow);
        this.settings.bind('max-output-tokens', maxTokensRow.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

        // Make the window a bit bigger to show all content
        window.set_default_size(650, 500);

        //Memory
        const MemoryGroup = new Adw.PreferencesGroup({
            title: _('Assistant\'s Memories'),
            description: _('Let your Assistant know more about you.'),
        });
        page.add(MemoryGroup);

        let textView = new Gtk.TextView();
        textView.set_vexpand(true);
        textView.set_hexpand(true);
        textView.set_wrap_mode(Gtk.WrapMode.WORD);
        textView.set_margin_start(12);
        textView.set_margin_end(12);
        textView.set_margin_top(12);
        textView.set_margin_bottom(12);

        this.textBuffer = textView.get_buffer(); // Get the text buffer

        let scrolledWindow = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC
        });
        scrolledWindow.set_child(textView);
        scrolledWindow.set_size_request(-1, 150);
        MemoryGroup.add(scrolledWindow);

        // 2. Bind the TextView's buffer to your GSettings key:
        //    You need to listen for changes on the buffer and update settings,
        //    and listen for changes on settings and update the buffer.

        // Function to update settings when buffer changes
        this.bufferChangedId = this.textBuffer.connect('changed', () => {
            let text = this.textBuffer.get_text(
                this.textBuffer.get_start_iter(),
                this.textBuffer.get_end_iter(),
                false
            );
            this.settings.set_string('memory', text); // 'my-text-setting' is your GSettings key
        });

        // Function to update buffer when settings change
        this.settingsChangedId = this.settings.connect('changed::memory', () => {
            let text = this.settings.get_string('memory');
            this.textBuffer.set_text(text, -1);
        });

        // 3. Initialize the TextView with the current setting value
        this.textBuffer.set_text(this.settings.get_string('memory'), -1);
    }
    dispose() {
        if (this.disposed)
            return;

        this.textBuffer.disconnect(this.bufferChangedId);
        this.settings.disconnect(this.settingsChangedId);

        super.dispose();
    }
}
