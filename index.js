const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Constants
const RETRY_DELAY = 2000;
const RETRY_429_DELAY = 10000;
const MAX_ID_ATTEMPTS = 100;
const MAX_TOTAL_RETRIES = 200;
const MAX_APPLICANTS = 5;

// API Endpoints
const BASE_API = 'https://ethiopianpassportapi.ethiopianairlines.com';
const fetchURL = 'https://ethiopianpassportapiu.ethiopianairlines.com/Schedule/api/V1.0/Schedule/SubmitAppointment';
const submitURL = 'https://ethiopianpassportapiu.ethiopianairlines.com/Request/api/V1.0/Request/SubmitRequest';
const paymentURL = 'https://ethiopianpassportapi.ethiopianairlines.com/Payment/api/V1.0/Payment/OrderRequest';
const uploadURL = 'https://ethiopianpassportapiu.ethiopianairlines.com/Request/api/V1.0/RequestAttachments/UploadAttachment';

// Mobile Profiles for better request rotation
const mobileProfiles = [
  {
    name: 'iPhone 14 - Safari',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    secChUaPlatform: '"iOS"'
  },
  {
    name: 'Samsung Galaxy S23 - Chrome',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
    platform: 'Android',
    secChUaPlatform: '"Android"'
  },
  {
    name: 'Pixel 7 - Chrome',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.199 Mobile Safari/537.36',
    platform: 'Android',
    secChUaPlatform: '"Android"'
  },
  {
    name: 'Huawei P40 - Chrome',
    userAgent: 'Mozilla/5.0 (Linux; Android 12; HUAWEI P40) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    platform: 'Android',
    secChUaPlatform: '"Android"'
  },
  {
    name: 'OnePlus 11 - Chrome',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; ONEPLUS CPH2447) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.134 Mobile Safari/537.36',
    platform: 'Android',
    secChUaPlatform: '"Android"'
  }
];

function getMobileProfile(index) {
  return mobileProfiles[index % mobileProfiles.length];
}

// Helper functions
function buildHeaders(profile) {
  return {
    'Content-Type': 'application/json',
    'Origin': 'https://www.ethiopianpassportservices.gov.et',
    'User-Agent': profile.userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.ethiopianpassportservices.gov.et/',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'Sec-Ch-Ua-Mobile': '?1',
    'Sec-Ch-Ua-Platform': profile.secChUaPlatform
  };
}

const buildRequestBody = (appointmentId, applicant) => ({
  requestId: 0,
  requestMode: 1,
  processDays: 2,
  officeId: 24,
  deliverySiteId: 1,
  requestTypeId: 2,
  appointmentIds: [appointmentId],
  userName: "",
  deliveryDate: "",
  status: 0,
  confirmationNumber: "",
  applicants: [
    {
      personId: 0,
      ...applicant,
      gender: applicant.gender,
      nationalityId: 1,
      height: "",
      eyeColor: "",
      hairColor: "Black",
      occupationId: null,
      birthPlace: applicant.birthPlace,
      birthCertificateId: "",
      photoPath: "",
      employeeID: "",
      applicationNumber: "",
      organizationID: "",
      isUnder18: applicant.isUnder18 ?? false,
      isAdoption: false,
      passportNumber: "",
      isDatacorrected: false,
      passportPageId: 1,
      correctionType: 0,
      maritalStatus: 0,
      email: "",
      requestReason: 0,
      address: {
        personId: 0,
        addressId: 0,
        city: "Addis Ababa",
        region: "Addis Ababa",
        state: "",
        zone: "",
        wereda: "",
        kebele: "",
        street: "",
        houseNo: "",
        poBox: "",
        requestPlace: ""
      },
      familyRequests: []
    }
  ]
});

const buildPaymentBody = (applicant, requestId) => ({
  FirstName: applicant.firstName,
  LastName: applicant.lastName,
  Email: "",
  Phone: applicant.phoneNumber,
  Amount: 20000,
  Currency: "ETB",
  City: "Addis Ababa",
  Country: "ET",
  Channel: "Mobile",
  PaymentOptionsId: 13,
  requestId: requestId
});

// Middleware
app.use(cors());
app.use(express.json());
const upload = multer({ dest: 'temp_uploads/' });

// Routes
app.post('/submit-applicants', async (req, res) => {
  const applicants = req.body;

  if (!Array.isArray(applicants) || applicants.length > MAX_APPLICANTS) {
    return res.status(400).json({ error: 'Invalid applicant data (max 5 allowed)' });
  }

  const results = [];

  for (let i = 0; i < 5; i++) {
    const applicant = applicants[i];
    const profile = getMobileProfile(i);
    const fullName = `${applicant.firstName} ${applicant.middleName} ${applicant.lastName}`;
    let attempt = 0;
    let success = false;

    console.log(`📋 [Worker ${i+1}] Processing ${fullName}`);

    while (attempt < MAX_TOTAL_RETRIES && !success) {
      attempt++;
      console.log(`🟡 [Worker ${i+1}] ${fullName} - Attempt ${attempt}`);

      try {
        // Fetch appointment
        const fetchRes = await axios.post(fetchURL, {
          id: 0,
          isUrgent: true,
          RequestTypeId: 2,
          OfficeId: 24,
          ProcessDays: 2
        }, { headers: buildHeaders(profile), validateStatus: () => true });

        if (fetchRes.status !== 200) {
          const delay = fetchRes.status === 429 ? RETRY_429_DELAY : RETRY_DELAY;
          console.warn(`⛔ [Worker ${i+1}] Status ${fetchRes.status} - Retrying in ${delay / 1000}s`);
          await new Promise(res => setTimeout(res, delay));
          continue;
        }

        const baseId = fetchRes.data?.appointmentResponses?.[0]?.id;
        if (!baseId) {
          console.warn(`❌ [Worker ${i+1}] No appointment ID returned`);
          await new Promise(res => setTimeout(res, RETRY_DELAY));
          continue;
        }

        console.log(`✅ [Worker ${i+1}] Got appointment ID base: ${baseId}`);

        // Parallel Submit Attempts
        const submitTasks = Array.from({ length: MAX_ID_ATTEMPTS }).map((_, offset) => {
          const tryId = baseId + offset;
          const body = buildRequestBody(tryId, applicant);
          return axios.post(submitURL, body, { headers: buildHeaders(profile), validateStatus: () => true })
            .then(res => ({ id: tryId, res }))
            .catch(err => ({ id: tryId, error: err }));
        });

        const settled = await Promise.allSettled(submitTasks);
        const successful = settled.find(r => 
          r.status === 'fulfilled' && 
          r.value?.res?.status === 200 &&
          r.value.res.data?.serviceResponseList?.[0]?.requestId
        );

        if (!successful) {
          console.log(`🔁 [${fullName}] All ID attempts failed. Retrying with new fetch ID...`);
          await new Promise(res => setTimeout(res, RETRY_DELAY));
          continue;
        }

        const { id: reservedId, res: submitRes } = successful.value;
        const reqId = submitRes.data.serviceResponseList[0].requestId;

        console.log(`🎯 [SUCCESS - ${fullName}] Reserved ID: ${reservedId} Request ID: ${reqId}`);

        // Process payment
        const paymentBody = buildPaymentBody(applicant, reqId);
        const paymentRes = await axios.post(paymentURL, paymentBody, {
          headers: buildHeaders(profile), validateStatus: () => true
        });

        if (paymentRes.status === 200) {
          const epNumber = paymentRes.data.orderId;
          const trackerNumber = paymentRes.data.traceNumber;

          console.log('\n' + '='.repeat(50));
          console.log(`🎯 SUCCESS: ${fullName}`);
          console.log(`🆔 Reserved ID: ${reservedId}`);
          console.log(`📦 Request ID: ${reqId}`);
          console.log(`💰 EP Number: ${epNumber}`);
          console.log(`📨 Tracker Number: ${trackerNumber}`);
          console.log('='.repeat(50) + '\n');

          results.push({
            fullName,
            appointmentId: reservedId,
            requestId: reqId,
            epNumber,
            trackerNumber,
            status: 'success'
          });
          success = true;
        } else {
          console.log(`💥 [PAYMENT - ${fullName}] Failed. Status: ${paymentRes.status}`);
          results.push({
            fullName,
            status: 'payment_failed',
            error: `Payment failed with status ${paymentRes.status}`
          });
        }

      } catch (err) {
        console.error(`💥 [${fullName}] Unexpected error: ${err.message}`);
        await new Promise(res => setTimeout(res, RETRY_DELAY));
      }
    }

    if (!success) {
      console.warn(`❌ [${fullName}] Max retries reached. Giving up.`);
      results.push({
        fullName,
        status: 'max_retries_reached',
        error: 'Max retries reached without success'
      });
    }
  }

  res.json({ results });
});

// Attachment handling
async function uploadAttachment(personRequestId, type, filePath) {
  const form = new FormData();
  form.append('personRequestId', personRequestId.toString());
  form.append(type.toString(), fs.createReadStream(filePath), {
    filename: type === '10' ? 'birth.jpg' : 'id.jpg',
    contentType: 'image/jpeg'
  });

  const profile = getMobileProfile(Math.floor(Math.random() * mobileProfiles.length));
  const headers = {
    ...form.getHeaders(),
    ...buildHeaders(profile)
  };

  try {
    const response = await axios.post(uploadURL, form, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return response.data;
  } catch (err) {
    throw err.response?.data || err.message;
  }
}

async function uploadAttachments(personRequestId, birthPath, idPath) {
  const results = {};
  if (birthPath) {
    try {
      results.birth = await uploadAttachment(personRequestId, '10', birthPath);
    } catch (error) {
      results.birth = { error };
    }
  }
  if (idPath) {
    try {
      results.id = await uploadAttachment(personRequestId, '11', idPath);
    } catch (error) {
      results.id = { error };
    }
  }
  return results;
}

app.post(
  '/upload-attachments',
  upload.fields([
    { name: 'birth', maxCount: 1 },
    { name: 'id', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { applicationNumber } = req.body;
      if (!applicationNumber) {
        return res.status(400).json({ error: 'Missing applicationNumber' });
      }

      const { requestPersonId, fullName } = await fetchPersonRequestId(applicationNumber);
      const birthFile = req.files?.birth?.[0]?.path || null;
      const idFile = req.files?.id?.[0]?.path || null;

      if (!birthFile && !idFile) {
        return res.status(400).json({ error: 'No valid files (birth or id) provided' });
      }

      const uploadResults = await uploadAttachments(requestPersonId, birthFile, idFile);

      // Cleanup temp files
      if (birthFile) fs.unlinkSync(birthFile);
      if (idFile) fs.unlinkSync(idFile);

      res.json({
        applicationNumber,
        fullName,
        requestPersonId,
        uploadResults
      });
    } catch (err) {
      console.error('💥 Upload error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

async function fetchPersonRequestId(applicationNumber) {
  const url = `${BASE_API}/Request/api/V1.0/Request/GetRequestsByApplicationNumber?applicationNumber=${applicationNumber}`;
  const profile = getMobileProfile(Math.floor(Math.random() * mobileProfiles.length));
  
  const res = await axios.get(url, {
    headers: buildHeaders(profile)
  });

  const person = res?.data?.serviceRequest?.personResponses;
  if (!person?.requestPersonId) {
    throw new Error(`No person found for applicationNumber ${applicationNumber}`);
  }

  return {
    requestPersonId: person.requestPersonId,
    fullName: `${person.firstName} ${person.middleName} ${person.lastName}`
  };
}

app.get('/applicant-info/:applicationNumber', async (req, res) => {
  try {
    const applicationNumber = req.params.applicationNumber;
    const { requestPersonId, fullName } = await fetchPersonRequestId(applicationNumber);
    res.json({ applicationNumber, fullName, requestPersonId });
  } catch (err) {
    res.status(404).json({ error: 'Applicant not found' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API running at http://localhost:${PORT}`);
});