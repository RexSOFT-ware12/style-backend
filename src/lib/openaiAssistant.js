const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

async function askWorkspaceAssistant({ system, history, message }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY is not configured on the server.");
    error.status = 503;
    error.code = "OPENAI_API_KEY_MISSING";
    error.publicMessage = "Workspace AI Assistant isn't configured yet — ask an administrator to set the OpenAI API key.";
    throw error;
  }

  let response;
  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          ...history.map((turn) => ({ role: turn.role, content: turn.text.slice(0, 3000) })),
          { role: "user", content: message },
        ],
        max_tokens: 900,
      }),
    });
  } catch (cause) {
    const error = new Error("Could not connect to OpenAI.");
    error.status = 503;
    error.code = "OPENAI_ASSISTANT_UNAVAILABLE";
    error.publicMessage = "The AI assistant is temporarily unavailable. Please try again shortly.";
    error.cause = cause;
    throw error;
  }

  if (!response.ok) {
    console.error("OpenAI workspace assistant request failed.", { status: response.status });
    const error = new Error(`OpenAI workspace assistant request failed with status ${response.status}.`);
    error.status = 503;
    error.code = "OPENAI_ASSISTANT_UNAVAILABLE";
    error.publicMessage = response.status === 429
      ? "The assistant is busy right now. Please try again in a moment."
      : "The AI assistant is temporarily unavailable. Please try again shortly.";
    throw error;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error("OpenAI returned an invalid response.");
    error.status = 503;
    error.code = "OPENAI_ASSISTANT_INVALID_RESPONSE";
    error.publicMessage = "The AI assistant is temporarily unavailable. Please try again shortly.";
    throw error;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    const error = new Error("OpenAI returned no assistant message.");
    error.status = 503;
    error.code = "OPENAI_ASSISTANT_EMPTY_RESPONSE";
    error.publicMessage = "The AI assistant couldn't generate a response just now. Please try again.";
    throw error;
  }

  return content.trim();
}

module.exports = { askWorkspaceAssistant };
