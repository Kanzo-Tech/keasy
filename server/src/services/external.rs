//! AI-powered external services for keasy.
//!
//! Uses the configured AI provider (Anthropic/OpenAI) to perform:
//! - Entity extraction via tool_use / structured output
//! - Grounding validation via separate LLM call
//!
//! TODO: Previously implemented fossil_lang::traits::services::ExternalServices.
//! That trait was removed with fossil_stdlib. The struct methods remain for
//! potential direct use from keasy routes.

use secrecy::{ExposeSecret, SecretString};

pub struct KeasyExternalServices {
    provider: String,
    api_key: SecretString,
    model: String,
    http: reqwest::Client,
}

impl KeasyExternalServices {
    pub fn new(provider: String, api_key: SecretString, model: Option<String>) -> Self {
        let default_model = match provider.as_str() {
            "anthropic" => "claude-sonnet-4-20250514",
            _ => "gpt-4o",
        };
        Self {
            provider,
            model: model.unwrap_or_else(|| default_model.to_string()),
            api_key,
            http: reqwest::Client::new(),
        }
    }

    /// Unified LLM call that dispatches to the correct provider.
    async fn call_llm(
        &self,
        system: &str,
        user: &str,
        tool: Option<&serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let (url, headers, body) = match self.provider.as_str() {
            "anthropic" => self.build_anthropic_request(system, user, tool),
            "openai" => self.build_openai_request(system, user, tool),
            other => return Err(format!("unsupported AI provider: {other}")),
        };

        let mut req = self.http.post(url).header("content-type", "application/json");
        for (key, value) in headers {
            req = req.header(key, value);
        }

        let resp = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("{} API request failed: {e}", self.provider))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("{} API error {status}: {text}", self.provider));
        }

        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("failed to parse {} response: {e}", self.provider))
    }

    fn build_anthropic_request(
        &self,
        system: &str,
        user: &str,
        tool: Option<&serde_json::Value>,
    ) -> (&'static str, Vec<(&'static str, String)>, serde_json::Value) {
        let mut body = serde_json::json!({
            "model": self.model,
            "max_tokens": 4096,
            "system": system,
            "messages": [{ "role": "user", "content": user }],
        });
        if let Some(tool_def) = tool {
            body["tools"] = serde_json::json!([tool_def]);
        }

        (
            "https://api.anthropic.com/v1/messages",
            vec![
                ("x-api-key", self.api_key.expose_secret().to_string()),
                ("anthropic-version", "2023-06-01".to_string()),
            ],
            body,
        )
    }

    fn build_openai_request(
        &self,
        system: &str,
        user: &str,
        tool: Option<&serde_json::Value>,
    ) -> (&'static str, Vec<(&'static str, String)>, serde_json::Value) {
        let mut body = serde_json::json!({
            "model": self.model,
            "max_tokens": 4096,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
        });
        if let Some(tool_def) = tool {
            // OpenAI expects { type: "function", function: { name, description, parameters } }
            let openai_tool = serde_json::json!({
                "type": "function",
                "function": {
                    "name": tool_def.get("name").and_then(|n| n.as_str()).unwrap_or("extract"),
                    "description": tool_def.get("description").and_then(|d| d.as_str()).unwrap_or(""),
                    "parameters": tool_def.get("input_schema").unwrap_or(tool_def),
                }
            });
            let func_name = tool_def.get("name").and_then(|n| n.as_str()).unwrap_or("extract");
            body["tools"] = serde_json::json!([openai_tool]);
            body["tool_choice"] = serde_json::json!({"type": "function", "function": {"name": func_name}});
        }

        (
            "https://api.openai.com/v1/chat/completions",
            vec![("Authorization", format!("Bearer {}", self.api_key.expose_secret()))],
            body,
        )
    }

    /// Parse tool_use result from provider response.
    fn parse_tool_result(&self, response: &serde_json::Value) -> Result<serde_json::Value, String> {
        match self.provider.as_str() {
            "anthropic" => Self::parse_anthropic_tool_result(response),
            _ => Self::parse_openai_tool_result(response),
        }
    }

    fn parse_anthropic_tool_result(response: &serde_json::Value) -> Result<serde_json::Value, String> {
        let content = response
            .get("content")
            .and_then(|c| c.as_array())
            .ok_or("missing content array in response")?;

        for block in content {
            if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                if let Some(input) = block.get("input") {
                    return Ok(input.clone());
                }
            }
        }
        // Fallback: try text content as JSON
        for block in content {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                if let Ok(parsed) = serde_json::from_str(text) {
                    return Ok(parsed);
                }
            }
        }
        Err("no tool_use result in response".to_string())
    }

    fn parse_openai_tool_result(response: &serde_json::Value) -> Result<serde_json::Value, String> {
        if let Some(call) = response
            .pointer("/choices/0/message/tool_calls/0/function/arguments")
            .and_then(|a| a.as_str())
        {
            return serde_json::from_str(call).map_err(|e| format!("failed to parse tool call args: {e}"));
        }
        // Fallback: try content
        if let Some(content) = response.pointer("/choices/0/message/content").and_then(|c| c.as_str()) {
            if let Ok(parsed) = serde_json::from_str(content) {
                return Ok(parsed);
            }
        }
        Err("no tool call result in response".to_string())
    }

    /// Extract text content from a non-tool response.
    fn parse_text_response(&self, response: &serde_json::Value) -> String {
        match self.provider.as_str() {
            "anthropic" => response
                .pointer("/content/0/text")
                .and_then(|t| t.as_str())
                .unwrap_or("false")
                .to_string(),
            _ => response
                .pointer("/choices/0/message/content")
                .and_then(|c| c.as_str())
                .unwrap_or("false")
                .to_string(),
        }
    }
}

impl KeasyExternalServices {
    /// Extract structured entities from text using an LLM.
    pub fn extract(
        &self,
        text: &str,
        schema: &serde_json::Value,
    ) -> Result<Vec<serde_json::Value>, String> {
        let system = "You are an entity extraction system. Extract all entities matching the provided schema from the text. Be precise and only extract entities that are clearly present in the text.";

        let tool = serde_json::json!({
            "name": "extract_entities",
            "description": "Extract structured entities from text",
            "input_schema": {
                "type": "object",
                "properties": {
                    "entities": {
                        "type": "array",
                        "items": { "type": "object" },
                        "description": "Array of extracted entities"
                    }
                },
                "required": ["entities"]
            }
        });

        let user_prompt = format!(
            "Extract entities from the following text according to this schema:\n\nSchema:\n{}\n\nText:\n{}",
            serde_json::to_string_pretty(schema).unwrap_or_default(),
            text
        );

        let rt = tokio::runtime::Handle::try_current()
            .map_err(|_| "no tokio runtime available".to_string())?;

        tokio::task::block_in_place(|| {
            rt.block_on(async {
                let response = self.call_llm(system, &user_prompt, Some(&tool)).await?;
                let result = self.parse_tool_result(&response)?;
                Ok(result
                    .get("entities")
                    .and_then(|e| e.as_array())
                    .cloned()
                    .unwrap_or_default())
            })
        })
    }

    /// Verify whether a claim is supported by source text.
    pub fn ground(
        &self,
        source_text: &str,
        claim: &str,
    ) -> Result<bool, String> {
        let system = "You are a fact verification system. Determine whether the following claim is supported by the source text. Respond with ONLY 'true' or 'false'.";
        let user_prompt = format!(
            "Source text:\n{}\n\nClaim: {}\n\nIs this claim supported by the source text? Answer true or false.",
            source_text, claim
        );

        let rt = tokio::runtime::Handle::try_current()
            .map_err(|_| "no tokio runtime available".to_string())?;

        tokio::task::block_in_place(|| {
            rt.block_on(async {
                let response = self.call_llm(system, &user_prompt, None).await?;
                let text = self.parse_text_response(&response);
                Ok(text.trim().to_lowercase().contains("true"))
            })
        })
    }
}
