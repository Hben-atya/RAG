// test-params.js
const text = "Education reform requires a whole-child approach. Teachers look through a different lens, focusing on gifts rather than deficiencies. Meanwhile, income inequality deeply impacts school performance, meaning we cannot improve test scores without fundamentally changing unstable community environments.";

function simulateChunking(chunkSize, overlap) {
    const words = text.split(" ");
    const step = chunkSize - overlap;
    let chunks = [];
    for (let i = 0; i < words.length; i += step) {
        chunks.push(words.slice(i, i + chunkSize).join(" "));
        if (i + chunkSize >= words.length) break;
    }
    return chunks;
}

console.log("--- TEST 1: Small Chunks (3 words, 1 overlap) ---");
console.log(simulateChunking(3, 1));

console.log("\n--- TEST 2: Optimal Chunks (12 words, 3 overlap) ---");
console.log(simulateChunking(12, 3));