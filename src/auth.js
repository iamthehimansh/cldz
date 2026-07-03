'use strict';

// Definitions for every supported auth method and how each maps to the
// environment variables Claude Code reads.
//
// Each field:
//   key      - property name stored on the profile
//   label    - prompt text
//   env      - the environment variable Claude Code reads
//   secret   - true => hidden input + treated as a secret
//   optional - true => may be left blank
//   default  - default value offered at the prompt
const AUTH_TYPES = {
  apiKey: {
    label: 'API key',
    hint: 'ANTHROPIC_API_KEY',
    fields: [
      { key: 'apiKey', label: 'Anthropic API key', env: 'ANTHROPIC_API_KEY', secret: true },
    ],
  },
  oauth: {
    label: 'OAuth token (Pro / Max)',
    hint: 'from `claude setup-token`',
    fields: [
      { key: 'oauthToken', label: 'Claude Code OAuth token', env: 'CLAUDE_CODE_OAUTH_TOKEN', secret: true },
    ],
  },
  gateway: {
    label: 'Custom gateway / proxy',
    hint: 'ANTHROPIC_BASE_URL',
    fields: [
      { key: 'baseUrl', label: 'Base URL (e.g. https://gateway.example.com)', env: 'ANTHROPIC_BASE_URL', secret: false },
      { key: 'authToken', label: 'Auth token (blank if the gateway needs none)', env: 'ANTHROPIC_AUTH_TOKEN', secret: true, optional: true },
    ],
  },
  bedrock: {
    label: 'Amazon Bedrock',
    hint: 'CLAUDE_CODE_USE_BEDROCK',
    staticEnv: { CLAUDE_CODE_USE_BEDROCK: '1' },
    note: 'Uses your standard AWS credentials (env, ~/.aws, or SSO).',
    fields: [
      { key: 'region', label: 'AWS region', env: 'AWS_REGION', secret: false, default: 'us-east-1' },
      { key: 'awsProfile', label: 'AWS profile (blank = default credentials)', env: 'AWS_PROFILE', secret: false, optional: true },
    ],
  },
  vertex: {
    label: 'Google Vertex AI',
    hint: 'CLAUDE_CODE_USE_VERTEX',
    staticEnv: { CLAUDE_CODE_USE_VERTEX: '1' },
    note: 'Uses Google Application Default Credentials (gcloud auth).',
    fields: [
      { key: 'project', label: 'GCP project ID', env: 'ANTHROPIC_VERTEX_PROJECT_ID', secret: false },
      { key: 'region', label: 'Cloud ML region', env: 'CLOUD_ML_REGION', secret: false, default: 'us-east5' },
    ],
  },
};

const TYPE_ORDER = ['apiKey', 'oauth', 'gateway', 'bedrock', 'vertex'];

function typeDef(type) {
  const def = AUTH_TYPES[type];
  if (!def) throw new Error(`unknown auth type: ${type}`);
  return def;
}

function isSecretField(field) {
  return Boolean(field.secret);
}

// Build the env var map to hand to `claude` from a fully-resolved profile
// (i.e. one whose field values are already populated).
function buildEnv(profile) {
  const def = typeDef(profile.type);
  const env = {};
  if (def.staticEnv) Object.assign(env, def.staticEnv);
  for (const field of def.fields) {
    const value = profile[field.key];
    if (value !== undefined && value !== null && value !== '') {
      env[field.env] = String(value);
    }
  }
  return env;
}

module.exports = { AUTH_TYPES, TYPE_ORDER, typeDef, buildEnv, isSecretField };
