const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generateWords = async (difficultyLevel, wordCategory, wordCount) => {

  try {
    // sanitize category
    const invalidCategories = ["toxic", "sexual", "irrelevant"];
    if (invalidCategories.includes(wordCategory?.toLowerCase())) {
      wordCategory = "common words";
    }

    const prompt = 
      `
      Generate ${wordCount} unique English words or phrases for a word guessing game.  

      Rules:  
      - Each entry must have at least 4 total letters (excluding spaces).  
      - Entries can be either:  
        • a single word (e.g., "apple"), OR  
        • a multi-word proper name/phrase (e.g., "new york", "golden gate").  
      - Only return actual valid entries within the category, not generic terms.  
      - Difficulty level: ${difficultyLevel}.  
      - Category: ${wordCategory}.  
      - All entries must be strictly in lowercase.  
      - Do not include explanations, just return the words/phrases in a clean JSON array format.  

      Example: ["iron man", "captain america", "black panther", "doctor strange", ...]
      `;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
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