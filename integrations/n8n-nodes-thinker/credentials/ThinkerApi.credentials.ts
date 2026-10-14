import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { THINKER_ATTRIBUTION_HEADERS } from '../nodes/shared/attribution';

export class ThinkerApi implements ICredentialType {
	name = 'thinkerApi';

	displayName = 'Thinker API';

	icon = {
		light: 'file:../nodes/Thinker/thinker-logo.svg',
		dark: 'file:../nodes/Thinker/thinker-logo.dark.svg',
	} as const;

	documentationUrl =
		'https://github.com/patrickbrandao/thinker/tree/main/integrations/n8n-nodes-thinker#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://localhost:2099',
			placeholder: 'http://localhost:2099',
			required: true,
			description: 'URL of your Thinker instance (default port 2099)',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			placeholder: 'thk_...',
			required: true,
			description: 'Thinker agent API key; it starts with thk_',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				...THINKER_ATTRIBUTION_HEADERS,
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			method: 'GET',
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/models',
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				...THINKER_ATTRIBUTION_HEADERS,
			},
		},
	};
}
