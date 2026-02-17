import {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class KoraApi implements ICredentialType {
  name = 'koraApi';
  displayName = 'Kora API';
  documentationUrl = 'https://github.com/Idkasam/Kora';

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '={{"Bearer " + $credentials.agentSecret}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.apiUrl}}',
      url: '/health',
    },
  };

  properties: INodeProperties[] = [
    {
      displayName: 'Agent Secret Key',
      name: 'agentSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      placeholder: 'kora_agent_sk_...',
      description: 'Your Kora agent secret key',
      required: true,
    },
    {
      displayName: 'Mandate ID',
      name: 'mandateId',
      type: 'string',
      default: '',
      placeholder: 'mandate_abc123def456',
      description: 'The mandate governing spending limits',
      required: true,
    },
    {
      displayName: 'API URL',
      name: 'apiUrl',
      type: 'string',
      default: 'https://api.koraprotocol.com',
      description: 'Kora API base URL',
    },
  ];
}
