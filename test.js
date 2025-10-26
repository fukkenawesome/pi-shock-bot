


import AhoCorasick from "aho-corasick";

function normalize(s) {
  return s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

const KEY_PHRASES = ["giveaway", "drop incoming", "new patch"].map(normalize);
const builder = new AhoCorasick(KEY_PHRASES.map(k => ({ key: k, value: k })));
const ac = builder.build();

// test
const text = "This is a new patch coming soon!";
console.log(ac.match(normalize(text)));