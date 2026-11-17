import { createHmac } from 'node:crypto';

export const businessToken = (operatorSecret, id) =>
  createHmac('sha256', operatorSecret).update(`iwe-oja-admin:${id}`).digest('base64url');
