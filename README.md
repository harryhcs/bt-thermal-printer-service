# Thermal Printer Service

A Node.js service for managing thermal printer connections and printing receipts via Bluetooth Low Energy (BLE). This service is designed to work with thermal printers like the M58-LL and similar BLE-enabled thermal printers.

## Features

- BLE printer discovery and connection
- Automatic printer reconnection
- Print queue management
- Support for text and receipt printing
- Configurable receipt format with:
  - School name
  - Title
  - Sale date
  - Items list
  - Total amount
  - Footer message
- Persistent printer selection

## Prerequisites

- Node.js (v14 or higher)
- Bluetooth Low Energy (BLE) adapter
- Compatible thermal printer (tested with M58-LL)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd printer
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
node index.js
```

The server will start on port 3000 by default. You can change this by setting the `PORT` environment variable.

## API Endpoints

### GET /devices
Scans for available BLE printers and returns a list of devices.

Response:
```json
[
  {
    "name": "Printer Name",
    "id": "device-id",
    "address": "device-address",
    "rssi": -50,
    "services": ["service-uuid"]
  }
]
```

### POST /connect
Connects to a specific printer.

Request:
```json
{
  "deviceId": "device-id"
}
```

Response:
```json
{
  "success": true
}
```

### POST /print/text
Prints a simple text message.

Request:
```json
{
  "deviceId": "device-id",
  "text": "Hello, World!"
}
```

Response:
```json
{
  "success": true
}
```

### POST /print/receipt
Prints a formatted receipt.

Request:
```json
{
  "deviceId": "device-id",
  "title": "SALES RECEIPT",
  "saleDate": "2024-03-21 14:30",
  "items": [
    { "name": "Item 1", "price": "10.00" },
    { "name": "Item 2", "price": "20.00" }
  ],
  "total": 30.00,
  "schoolName": "Your School",
  "footer": "Thank you!"
}
```

Response:
```json
{
  "success": true
}
```

### POST /disconnect
Disconnects from the current printer.

Response:
```json
{
  "success": true
}
```

## Receipt Format

The receipt is formatted as follows:

```
[School Name] (if provided)
----------------
[Title]
----------------
[Sale Date] (if provided)
----------------
[Items]
Item 1          R10.00
Item 2          R20.00
----------------
Total: R30.00
----------------
[Footer] (if provided)
```

## Error Handling

The service includes comprehensive error handling for:
- Printer connection issues
- Print queue management
- Invalid print jobs
- BLE communication errors

## Development

The project uses:
- `@abandonware/noble` for BLE communication
- `express` for the API server
- `cors` for cross-origin resource sharing

## License

[MIT](LICENSE)`