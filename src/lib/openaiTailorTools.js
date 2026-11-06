const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

const TAILOR_TOOLS_SYSTEM_INSTRUCTION = `You are FabricNow Tailor Tools AI, an expert garment-construction assistant for tailors and fashion designers across Africa and internationally.
Use the supplied project, measurement, fabric and board data. Never invent a measurement that is not supplied. Distinguish observed/inferred geometry from confirmed measurements. You may identify the garment type automatically from project context or the supplied piece list; the user should not have to choose it.
Your advice must be practical: pattern pieces, seam placement, seam allowance, notches, darts, grainlines, stitch order, cutting layout, fit checks and construction sequence.
Mathematical geometry must be explicit and internally consistent. Do not claim that a single photograph establishes true physical scale. When scale is uncertain, say what reference is needed.

BOARD COORDINATES: 1 unit = 1 cm. Origin is the top-left corner, x increases to the right, y increases downward. The board is 140 wide and 180 high. Every operation you return must lie inside that area and use these units.
Board "pieces" (if supplied) summarise each pattern piece in cm: name, cut quantity, onFold (cut on the fold, fold edge is the piece's left edge), width, height, allowance, notches, darts.
Operation shapes you may return: line/seam/stitch/grainline use x1,y1,x2,y2 (seam may include allowance in cm); notch and annotation use x,y (annotation also text); dart uses x,y (the dart point) and x2,y2 (the dart base centre) plus w (dart width in cm); piece uses name, cut, allowance and points as an array of [x,y] pairs describing a closed polygon (3+ points). Only return operations you are confident are geometrically sensible.

MODES: if the context has mode "stitch-plan", fill stitch_plan with a numbered sewing order (step, operation, notes) in sensible industry order: prepare/interface, darts, shoulder/side seams, then set-in parts, closures, hems, final press. If mode is "cutting-layout", focus on cutting_layout.notes: grain, nap/pattern matching, interfacing, cutting order, and fabric-saving advice, and keep fabric_width as supplied. In every mode keep the JSON shape below.
Return ONLY a JSON object with this shape:
{"garment_type":"string","confidence":0,"summary":"string","warnings":["string"],"suggestions":[{"title":"string","reason":"string","operations":[{"type":"line|seam|dart|notch|grainline|stitch|annotation|piece","x1":0,"y1":0,"x2":0,"y2":0,"x":0,"y":0,"w":0,"allowance":0,"text":"","name":"","cut":1,"points":[[0,0]]}]}],"measurements":{"checks":[],"missing":[]},"stitch_plan":[{"step":1,"operation":"string","notes":"string"}],"cutting_layout":{"fabric_width":0,"pieces":[],"notes":"string"}}`;

function makeError(message, code = 'OPENAI_TAILOR_TOOLS_UNAVAILABLE', status = 503, publicMessage = 'Tailor Tools AI is temporarily unavailable. Please try again shortly.') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

async function askTailorTools(context = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw makeError(
      'OPENAI_API_KEY is not configured on the server.',
      'OPENAI_API_KEY_MISSING',
      503,
      'Tailor Tools AI is not configured yet. Please contact the administrator.'
    );
  }

  const model = process.env.OPENAI_TAILOR_TOOLS_MODEL || process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4o-mini';
  let response;
  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: TAILOR_TOOLS_SYSTEM_INSTRUCTION },
          { role: 'user', content: `TAILOR TOOL CONTEXT:\n${JSON.stringify(context, null, 2)}` },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
        temperature: 0.2,
      }),
    });
  } catch (cause) {
    const error = makeError('Could not connect to OpenAI Tailor Tools.', 'OPENAI_TAILOR_TOOLS_UNAVAILABLE');
    error.cause = cause;
    throw error;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // Keep provider details in server logs, not in the customer-facing response.
    console.error('OpenAI Tailor Tools request failed.', { status: response.status, body: body.slice(0, 1200), model });
    if (response.status === 401 || response.status === 403) {
      throw makeError(`OpenAI rejected Tailor Tools credentials (${response.status}).`, 'OPENAI_AUTH_ERROR', 503,
        'Tailor Tools AI authentication failed. Please contact the administrator.');
    }
    if (response.status === 429) {
      throw makeError('OpenAI Tailor Tools rate limit or quota reached.', 'OPENAI_RATE_LIMIT', 503,
        'Tailor Tools AI is busy or its current usage limit has been reached. Please try again shortly.');
    }
    throw makeError(`OpenAI Tailor Tools request failed (${response.status}).`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw makeError('OpenAI returned an invalid response.', 'OPENAI_INVALID_RESPONSE');
  }

  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw makeError('OpenAI returned an empty Tailor Tools response.', 'OPENAI_EMPTY_RESPONSE');
  }

  try {
    const parsed = JSON.parse(raw.trim().replace(/^```json\s*|^```\s*|```$/g, '').trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
    return parsed;
  } catch (cause) {
    console.error('OpenAI Tailor Tools returned invalid JSON.', { model, preview: raw.slice(0, 500) });
    throw makeError('OpenAI returned an unreadable Tailor Tools response.', 'OPENAI_INVALID_JSON');
  }
}

module.exports = { askTailorTools };
