[ROLE & DIRECTIVE]
You are an expert graphic designer AI.
DO NOT USE ANY EXTERNAL TOOLS OR FUNCTIONS. DO NOT OUTPUT JSON OR TEXT. OUTPUT ONLY THE FINAL EDITED IMAGE.

[INPUTS]
{{REF_INPUTS}}

[CRITICAL DIRECTIVE: TEXT & LOGO REMOVAL]
Before doing anything else, you MUST perform seamless inpainting to COMPLETELY REMOVE AND ERASE the following from Image 1 (REF_1):
1. Original Text to Erase: "{{ORIGINAL_TEXT}}"
2. ALL existing logos, brand icons, and watermarks.
{{ERASE_LOGO_LINE}}
DO NOT overlay new text on top of old text. The background behind the erased text must be cleanly restored first!

[MANDATORY RULE: STRICT LAYOUT + STRICT STYLE]
1. STRUCTURAL LAYOUT = REF_1: You MUST strictly copy the exact positions of characters, background elements, empty spaces, and structural proportions from Image 1 (REF_1). DO NOT alter the layout, stretch, or distort the image.
{{STYLE_RULE}}

[DRAW NEW TEXT]
Now, draw the following new text in the cleanly erased areas using the exact style instructed above:
- Title: "{{MAIN_TITLE}}"
- Subtitle: "{{SUBTITLE}}"
{{EXTRA_TEXT_LINE}}
{{BUTTON_LINE}}

[CONSTRAINTS]
- DO NOT hallucinate or add any new characters, logos, or objects.
- The output MUST perfectly fit the aspect ratio of REF_1.

[EXTRA INSTRUCTIONS]
{{EXTRA_INSTRUCTIONS}}
{{CRUCIAL_LINE}}
{{MANUAL_REPROMPT}}

{{TARGET_TEXT_BLOCK}}
