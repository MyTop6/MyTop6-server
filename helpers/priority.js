// helpers/priority.js
function computePriorityFromType(type = "") {
  const t = String(type).toLowerCase().trim();

  // URGENT: CSAM + graphic violence/gore (+ optionally threats/terrorism)
  const urgentTerms = [
    "csam", "child sexual", "child abuse", "exploit", "exploitation",
    "gore", "graphic_violence", "graphic violence", "beheading", "dismember",
    "terrorism", "violent extremism", "direct threat"
  ];

  // HIGH: pornography / nudity (sexual content that isn't CSAM)
  const highTerms = [
    "porn", "pornography", "nudity", "explicit sexual", "adult sexual",
    "sexual content", "obscene"
  ];

  if (urgentTerms.some(k => t.includes(k))) return "urgent";
  if (highTerms.some(k => t.includes(k))) return "high";
  return "medium";
}

module.exports = { computePriorityFromType };