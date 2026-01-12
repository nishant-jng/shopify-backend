const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    const response = await axios.get(
      "https://eximtradedata.com/EximAPI/india/export/2020-06-15/2022-06-25",
      {
        headers: {
          Authorization: `Bearer ${process.env.EXIM_KEY}`,
          Accept: "application/json"
        },
        timeout: 15000
      }
    );

    console.log("API Data:", response.data);
    res.json(response.data);

  } catch (error) {
    console.error("Status:", error.response?.status);
    console.error("Data:", error.response?.data);
    console.error("Message:", error.message);

    res.status(error.response?.status || 500).json({
      error: "Exim API request failed",
      details: error.response?.data || error.message
    });
  }
});

module.exports = router;
