import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class KoraAgentApi implements ICredentialType {
	name = 'koraAgentApi';
	displayName = 'Kora Agent API';
	documentationUrl = 'https://github.com/Idkasam/Kora';
	properties: INodeProperties[] = [
		{
			displayName: 'Agent Secret',
			name: 'agentSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'kora_agent_sk_...',
			description: 'Your Kora agent secret key (shown once at agent creation)',
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
