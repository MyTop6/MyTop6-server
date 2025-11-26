// helpers/sessionStore.js
// Simple singleton session store (swap for DB/Redis later)
const sessions = new Map();
module.exports = { sessions };
