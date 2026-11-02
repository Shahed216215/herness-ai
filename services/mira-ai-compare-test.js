const { generate } = require("./ai");

async function test(model) {
  try {
    const result = await generate(
      "Reply with exactly: MIRA_TEST_OK",
      [],
      [
        {
          role: "user",
          content: "Reply with exactly: MIRA_TEST_OK"
        }
      ],
      {
        model,
        systemInstruction: "You are Mira. Reply briefly.",
        maxTokens: 50
      }
    );

    console.log("MODEL:", model);
    console.log("STATUS: SUCCESS");
    console.log("TEXT:", JSON.stringify(result?.text || ""));
    console.log("---");

  } catch (error) {
    console.log("MODEL:", model);
    console.log("STATUS: ERROR");
    console.log(
      "ERROR:",
      error?.message || String(error)
    );
    console.log(
      "HTTP_STATUS:",
      error?.status ||
      error?.statusCode ||
      error?.response?.status ||
      "unknown"
    );
    console.log("---");
  }
}

(async () => {
  await test("openai/gpt-oss-20b");
  await test("openai/gpt-oss-120b");
})();
