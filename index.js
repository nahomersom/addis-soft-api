
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

    console.log(`📋 Processing ${fullName}`);

    while (true) {
      attempt++;
      console.log(`🟡 Attempt ${attempt} - Fetching appointment for ${fullName}...`);

      try {
        const fetchRes = await axios.post(fetchURL, {
          id: 0,
          isUrgent: true,
          RequestTypeId: 2,
          OfficeId: 24,
          ProcessDays: 2
        }, { headers });

        if (fetchRes.status !== 200) {
          const wait = fetchRes.status === 429 ? RETRY_429_DELAY : RETRY_DELAY;
          console.log(`⛔ ${fullName} - ${fetchRes.status} Error: ${fetchRes.data?.message || 'Unknown'} | Retrying in ${wait / 1000}s...`);
          await new Promise(res => setTimeout(res, wait));
          continue;
        }

        const baseId = fetchRes.data?.appointmentResponses?.[0]?.id;
        if (!baseId) {
          console.log(`❌ No appointment ID found for ${fullName}. Retrying...`);
          await new Promise(res => setTimeout(res, RETRY_DELAY));
          continue;
        }

        console.log(`🆔 Appointment ID fetched for ${fullName}: ${baseId}`);

        for (let offset = 0; offset < MAX_ID_ATTEMPTS; offset++) {
          const tryId = baseId + offset;
          const submitBody = buildRequestBody(tryId, applicant);

          const submitRes = await axios.post(submitURL, submitBody, { headers });

          const msg = submitRes.data?.message || '';
          const reqId = submitRes.data?.serviceResponseList?.[0]?.requestId;

          if (submitRes.status === 200 && reqId) {
            console.log(`📦 SubmitResponse for ${fullName} [ID ${tryId}]:\n`, JSON.stringify(submitRes.data, null, 2));

            const paymentBody = buildPaymentBody(applicant, reqId);
            const paymentRes = await axios.post(paymentURL, paymentBody, { headers });

            if (paymentRes.status === 200) {
              console.log(`💰 Payment succeeded for ${fullName}, trace: ${paymentRes.data?.traceNumber}`);
              console.log(`📦 PaymentResponse:\n`, JSON.stringify(paymentRes.data, null, 2));
            } else {
              console.log(`💥 Payment failed for ${fullName} (status: ${paymentRes.status})`);
            }

            results.push({
              fullName,
              appointmentId: tryId,
              submitResponse: submitRes.data,
              paymentResponse: paymentRes.data,
              traceNumber: paymentRes.data?.traceNumber
            });

            break;
          } else if (msg.toLowerCase().includes("already selected")) {
            console.log(`❗ ID ${tryId} already taken for ${fullName}. Trying next...`);
          } else {
            console.log(`🔁 ID ${tryId} failed for ${fullName} (${msg})`);
          }

          await new Promise(res => setTimeout(res, 500));
        }

        break;

      } catch (err) {
        console.log(`💥 ${fullName} error: ${err.message}`);
        await new Promise(res => setTimeout(res, RETRY_DELAY));
      }
    }

    console.log(`✅ Done processing ${fullName}\n`);
  }

  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`🚀 API running at http://localhost:${PORT}`);
});

