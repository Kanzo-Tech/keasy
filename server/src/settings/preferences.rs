use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preferences {
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_mono_font_family")]
    pub mono_font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: String,
    #[serde(default = "default_font_size")]
    pub mono_font_size: String,
}

fn default_accent_color() -> String { "neutral".into() }
fn default_font_family() -> String { "geist".into() }
fn default_mono_font_family() -> String { "geist-mono".into() }
fn default_font_size() -> String { "default".into() }

impl Default for Preferences {
    fn default() -> Self {
        Self {
            accent_color: default_accent_color(),
            font_family: default_font_family(),
            mono_font_family: default_mono_font_family(),
            font_size: default_font_size(),
            mono_font_size: default_font_size(),
        }
    }
}
