const express = require("express");
const router = express.Router();

router.get("/cities", async (req, res) => {
  const queryRaw = String(req.query.query || "").trim();
  if (!queryRaw || queryRaw.length < 2) {
    return res.json({ cities: [] });
  }

  const url =
    `https://wft-geo-db.p.rapidapi.com/v1/geo/cities?` +
    `namePrefix=${encodeURIComponent(queryRaw)}` +
    `&countryIds=US` +
    `&types=CITY` +
    `&sort=-population` +
    `&limit=10`;

  try {
    const apiRes = await fetch(url, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": process.env.GEODB_RAPIDAPI_KEY,
        "X-RapidAPI-Host": "wft-geo-db.p.rapidapi.com",
      },
    });

    if (!apiRes.ok) {
      console.error("GeoDB status:", apiRes.status);
      return res.json({ cities: [] });
    }

    const data = await apiRes.json();

    const cities = (data.data || []).map(c => ({
      city: c.city,
      stateCode: c.regionCode,
    }));

    return res.json({ cities });
  } catch (err) {
    console.error("GeoDB error:", err);
    return res.json({ cities: [] });
  }
});

module.exports = router;