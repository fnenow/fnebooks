const { google } = require("googleapis");
const { Readable } = require("stream");

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  return google.drive({
    version: "v3",
    auth,
  });
}

async function uploadReceiptToDrive(file, storedFilename) {
  const drive = getDriveClient();

  const response = await drive.files.create({
    requestBody: {
      name: storedFilename,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    media: {
      mimeType: file.mimetype,
      body: bufferToStream(file.buffer),
    },
    fields: "id, webViewLink",
  });

  return {
    fileId: response.data.id,
    webViewLink: response.data.webViewLink,
  };
}

module.exports = {
  uploadReceiptToDrive,
};