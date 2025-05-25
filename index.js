
// require('dotenv').config();
// const routes = require('./routes/routes');
// const express = require('express');
// const cors = require('cors')
// const mongoose = require('mongoose');
// const app = express();
// app.use(express.json());
// app.use(cors())
// //storing the connection string
// const mongoString = process.env.DATABASE_URL;

// mongoose.connect(mongoString);
// const database = mongoose.connection;

// database.on('error', (error) => {
//     console.log(error)
// })

// database.once('connected', () => {
//     console.log('Database Connected');
// })





// //base endpoint and the contents of the routes
// app.use('/api', routes)
// const port = process.env.PORT || 8000
// app.listen(port, () => {
//     console.log(`Server Started at ${port}`)
// })
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const RETRY_DELAY = 2000;
const RETRY_429_DELAY = 10000;
const MAX_ID_ATTEMPTS = 5;
const MAX_APPLICANTS = 5;

const fetchURL = 'https://ethiopianpassportapiu.ethiopianairlines.com/Schedule/api/V1.0/Schedule/SubmitAppointment';
const submitURL = 'https://ethiopianpassportapiu.ethiopianairlines.com/Request/api/V1.0/Request/SubmitRequest';
const paymentURL = 'https://ethiopianpassportapi.ethiopianairlines.com/Payment/api/V1.0/Payment/OrderRequest';

const headers = {
  'Content-Type': 'application/json',
  'Origin': 'https://www.ethiopianpassportservices.gov.et'
};

app.use(cors());
app.use(express.json());

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
      gender: 0,
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
      isUnder18: false,
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

app.post('/submit-applicants', async (req, res) => {
  const applicants = req.body;

  if (!Array.isArray(applicants) || applicants.length > MAX_APPLICANTS) {
    return res.status(400).json({ error: 'Invalid applicant data (max 5 allowed)' });
  }

 const results = [];

for (let i = 0; i < applicants.length; i++) {
  const applicant = applicants[i];
  const fullName = `${applicant.firstName} ${applicant.middleName} ${applicant.lastName}`;
  let attempt = 0;
  const logs = [];

  logs.push(`📋 Processing ${fullName}`);

  while (attempt < 5) {
    attempt++;
    logs.push(`🟡 Attempt ${attempt} - Fetching appointment...`);

    try {
      const fetchRes = await axios.post(fetchURL, {
        id: 0,
        isUrgent: true,
        RequestTypeId: 2,
        OfficeId: 24,
        ProcessDays: 2
      }, { headers });

      const baseId = fetchRes.data?.appointmentResponses?.[0]?.id;
      if (!baseId) {
        logs.push(`❌ No appointment ID. Retrying...`);
        await new Promise(res => setTimeout(res, RETRY_DELAY));
        continue;
      }

      for (let offset = 0; offset < MAX_ID_ATTEMPTS; offset++) {
        const tryId = baseId + offset;
        const submitBody = buildRequestBody(tryId, applicant);

        const submitRes = await axios.post(submitURL, submitBody, { headers });
        const reqId = submitRes.data?.serviceResponseList?.[0]?.requestId;

        if (submitRes.status === 200 && reqId) {
          logs.push(`✅ Reserved ID ${tryId}`);
          const paymentBody = buildPaymentBody(applicant, reqId);
          const paymentRes = await axios.post(paymentURL, paymentBody, { headers });

          if (paymentRes.status === 200) {
            logs.push(`💰 Payment success. Trace: ${paymentRes.data?.traceNumber}`);
          } else {
            logs.push(`💥 Payment failed. Status: ${paymentRes.status}`);
          }

          results.push({
            fullName,
            appointmentId: tryId,
            logs,
            submitResponse: submitRes.data,
            paymentResponse: paymentRes.data
          });

          break;
        } else {
          logs.push(`⚠️ Submit failed: ${submitRes.data?.message || 'Unknown error'}`);
        }

        await new Promise(res => setTimeout(res, 500));
      }

      break;

    } catch (err) {
      logs.push(`💥 Error: ${err.message}`);
      await new Promise(res => setTimeout(res, RETRY_DELAY));
    }
  }

  if (attempt >= 5) {
    logs.push(`⛔ Max retries reached for ${fullName}`);
    results.push({
      fullName,
      logs,
      error: 'Max retry limit reached'
    });
  }
}

res.json({ results });


  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`🚀 API running at http://localhost:${PORT}`);
});

