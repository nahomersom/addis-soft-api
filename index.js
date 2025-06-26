const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const CONFIG = {
  RETRY_DELAY: 2000,
  RETRY_429_DELAY: 10000,
  MAX_ID_ATTEMPTS: 5,
  MAX_APPLICANTS: 5,
  MAX_RETRIES: 3,
  REQUEST_TIMEOUT: 8000,
  RATE_LIMIT_COOLDOWN: 60000 // 1 minute cooldown after multiple 429s
};

// API Endpoints
const API_BASE = 'https://ethiopianpassportapiu.ethiopianairlines.com';
const fetchURL = `${API_BASE}/Schedule/api/V1.0/Schedule/SubmitAppointment`;
const submitURL = `${API_BASE}/Request/api/V1.0/Request/SubmitRequest`;
const paymentURL = 'https://ethiopianpassportapi.ethiopianairlines.com/Payment/api/V1.0/Payment/OrderRequest';
const uploadURL = `${API_BASE}/Request/api/V1.0/RequestAttachments/UploadAttachment`;

// User Agent Rotation
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1'
];

function getRandomHeaders() {
  return {
    'Content-Type': 'application/json',
    'Origin': 'https://www.ethiopianpassportservices.gov.et',
    'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.ethiopianpassportservices.gov.et/',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'X-Forwarded-For': `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
  };
}

// Middleware
app.use(cors());
app.use(express.json());

// File upload setup
const upload = multer({ dest: 'temp_uploads/' });

// Helper functions
async function makeRequestWithRetry(url, data, options = {}) {
  let attempt = 0;
  let last429Time = 0;
  let rateLimitCount = 0;
  
  while (attempt < CONFIG.MAX_RETRIES) {
    attempt++;
    try {
      // Add jitter to avoid synchronized requests
      const jitter = Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, jitter));
      
      // Check if we need to cool down
      const now = Date.now();
      if (rateLimitCount >= 2 && now - last429Time < CONFIG.RATE_LIMIT_COOLDOWN) {
        const waitTime = CONFIG.RATE_LIMIT_COOLDOWN - (now - last429Time);
        console.log(`🚨 Rate limit cooldown - waiting ${waitTime/1000}s`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        rateLimitCount = 0;
      }
      
      const response = await axios({
        method: options.method || 'post',
        url,
        data,
        headers: options.headers || getRandomHeaders(),
        timeout: CONFIG.REQUEST_TIMEOUT,
        validateStatus: (status) => status < 500 // Don't throw for 429
      });
      
      if (response.status === 429) {
        rateLimitCount++;
        last429Time = Date.now();
        const retryAfter = response.headers['retry-after'] 
          ? parseInt(response.headers['retry-after']) * 1000 
          : CONFIG.RETRY_429_DELAY;
        
        console.log(`⚠️ 429 Received - Waiting ${retryAfter/1000}s`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }
      
      return response;
    } catch (error) {
      if (attempt >= CONFIG.MAX_RETRIES) throw error;
      
      const delay = error.response?.status === 429 
        ? CONFIG.RETRY_429_DELAY 
        : CONFIG.RETRY_DELAY * Math.pow(2, attempt);
      
      console.log(`⏳ Attempt ${attempt} failed - Retrying in ${delay/1000}s`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Request body builders (same as before)
const buildRequestBody = (appointmentId, applicant) => ({ /* ... */ });
const buildPaymentBody = (applicant, requestId) => ({ /* ... */ });

// File upload endpoint
app.post('/upload-attachments', upload.fields([
  { name: 'birth', maxCount: 1 },
  { name: 'id', maxCount: 1 }
]), async (req, res) => {
  try {
    const { applicationNumber } = req.body;
    if (!applicationNumber) {
      return res.status(400).json({ error: 'Missing applicationNumber' });
    }

    // Fetch person request ID
    const personInfo = await makeRequestWithRetry(
      `${API_BASE}/Request/api/V1.0/Request/GetRequestsByApplicationNumber?applicationNumber=${applicationNumber}`,
      null,
      { method: 'get' }
    );

    const person = personInfo.data?.serviceRequest?.personResponses;
    if (!person?.requestPersonId) {
      return res.status(404).json({ error: 'Applicant not found' });
    }

    // Upload files
    const uploaded = [];
    const files = req.files || {};
    
    if (files.birth) {
      const form = new FormData();
      form.append('personRequestId', person.requestPersonId.toString());
      form.append('10', fs.createReadStream(files.birth[0].path), {
        filename: 'birth.jpg',
        contentType: 'image/jpeg'
      });

      const uploadRes = await makeRequestWithRetry(
        uploadURL,
        form,
        { headers: form.getHeaders() }
      );
      uploaded.push('birth');
    }

    if (files.id) {
      const form = new FormData();
      form.append('personRequestId', person.requestPersonId.toString());
      form.append('11', fs.createReadStream(files.id[0].path), {
        filename: 'id.jpg',
        contentType: 'image/jpeg'
      });

      const uploadRes = await makeRequestWithRetry(
        uploadURL,
        form,
        { headers: form.getHeaders() }
      );
      uploaded.push('id');
    }

    // Cleanup temp files
    Object.values(files).flat().forEach(file => fs.unlinkSync(file.path));

    res.json({
      applicationNumber,
      fullName: `${person.firstName} ${person.middleName} ${person.lastName}`,
      requestPersonId: person.requestPersonId,
      uploaded
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Main applicant submission endpoint
app.post('/submit-applicants', async (req, res) => {
  try {
    const applicants = req.body;
    if (!Array.isArray(applicants) || applicants.length > CONFIG.MAX_APPLICANTS) {
      return res.status(400).json({ error: `Maximum ${CONFIG.MAX_APPLICANTS} applicants allowed` });
    }

    const results = [];
    
    // Process applicants sequentially to avoid overwhelming the server
    for (const applicant of applicants) {
      const fullName = `${applicant.firstName} ${applicant.middleName} ${applicant.lastName}`;
      const result = { fullName };
      
      try {
        // Step 1: Get appointment ID
        const fetchRes = await makeRequestWithRetry(fetchURL, {
          id: 0,
          isUrgent: true,
          RequestTypeId: 2,
          OfficeId: 24,
          ProcessDays: 2
        });
        
        const baseId = fetchRes.data?.appointmentResponses?.[0]?.id;
        if (!baseId) {
          throw new Error('No appointment ID returned');
        }
        
        // Step 2: Try to reserve an appointment
        let reservedId, requestId;
        for (let offset = 0; offset < CONFIG.MAX_ID_ATTEMPTS; offset++) {
          const tryId = baseId + offset;
          const submitRes = await makeRequestWithRetry(
            submitURL,
            buildRequestBody(tryId, applicant)
          );
          
          if (submitRes.status === 200 && submitRes.data?.serviceResponseList?.[0]?.requestId) {
            reservedId = tryId;
            requestId = submitRes.data.serviceResponseList[0].requestId;
            break;
          }
        }
        
        if (!reservedId) {
          throw new Error('All appointment attempts failed');
        }
        
        // Step 3: Process payment
        const paymentRes = await makeRequestWithRetry(
          paymentURL,
          buildPaymentBody(applicant, requestId)
        );
        
        result.success = true;
        result.appointmentId = reservedId;
        result.requestId = requestId;
        result.payment = paymentRes.data;
      } catch (error) {
        result.success = false;
        result.error = error.message;
      }
      
      results.push(result);
    }
    
    res.json({ results });
  } catch (error) {
    console.error('Submission error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});