const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generateWords = async (difficultyLevel, wordCategory, wordCount) => {

  try {
    // sanitize category
    const invalidCategories = ["toxic", "sexual", "irrelevant"];
    if (invalidCategories.includes(wordCategory?.toLowerCase())) {
      wordCategory = "common words";
    }

    const prompt = `
      Generate ${wordCount} unique and commonly recognized English words or multi-word phrases for a word guessing game.

      Rules:
      - Category: ${wordCategory}.
      - Difficulty level: ${difficultyLevel}.
      - Each entry must be a complete, meaningful name or phrase that people commonly and popularly know (not just partial or generic words).
      - Minimum 4 characters (excluding spaces).
      - Return only a clean JSON array of lowercase strings.
      - Do not include explanations, numbering, or extra text.

      Example:
      ["jurassic park", "chicken biryani", "grand theft auto", "naruto uzumaki"]
      `;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
    const result = await model.generateContent(prompt);

    let text = result.response.text();

    // try parsing JSON safely
    let words = [];
    try {
      words = JSON.parse(text);
    } catch {
      // fallback: extract words if not pure JSON
      words = text
        .replace(/[\[\]"]/g, "")
        .split(/[\s,]+/)
        .filter((w) => w.length >= 4)
        .slice(0, 10);
    }

    // ensure uniqueness + length filter
    const uniqueWords = [...new Set(words)].filter((w) => w.length >= 4);

    return uniqueWords.slice(1, 10);
  } catch (err) {
    console.error("Gemini word generation failed:", err);
    return []; // fallback if Gemini fails
  }
};

module.exports = { generateWords } ;