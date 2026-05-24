// OCPP 1.6 JSON Schema Validator
// Simple validation for required fields per action

interface ValidationRule {
  required?: string[];
}

const ocppSchemas: Record<string, ValidationRule> = {
  BootNotification: {
    required: ['chargePointModel', 'chargePointVendor'],
  },
  Heartbeat: {
    required: [],
  },
  StatusNotification: {
    required: ['connectorId', 'errorCode', 'status'],
  },
  StartTransaction: {
    required: ['connectorId', 'idTag', 'meterStart', 'timestamp'],
  },
  StopTransaction: {
    required: ['meterStop', 'timestamp', 'transactionId'],
  },
  Authorize: {
    required: ['idTag'],
  },
  MeterValues: {
    required: ['connectorId', 'meterValue'],
  },
  DataTransfer: {
    required: ['vendorId'],
  },
  FirmwareStatusNotification: {
    required: ['status'],
  },
  DiagnosticsStatusNotification: {
    required: ['status'],
  },
};

class SchemaValidator {
  validate(action: string, payload: Record<string, unknown>): string | null {
    const schema = ocppSchemas[action];
    if (!schema) {
      // Unknown actions pass validation — will be handled as NotImplemented
      return null;
    }

    const required = schema.required ?? [];
    for (const field of required) {
      if (payload[field] === undefined || payload[field] === null) {
        return `Missing required field: ${field}`;
      }
    }

    return null;
  }
}

export const schemaValidator = new SchemaValidator();
