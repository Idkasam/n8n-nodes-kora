import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class KoraAdminApi implements ICredentialType {
	name = 'koraAdminApi';
	displayName = 'Kora Admin API';
	documentationUrl = 'https://github.com/Idkasam/Kora';
	properties: INodeProperties[] = [
		{
			displayName: 'Admin Key',
			name: 'adminKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'kora_admin_sk_...',
		},
		{
			displayName: 'API URL',
			name: 'apiUrl',
			type: 'string',
			default: 'https://api.koraprotocol.com',
		},
	];
}
