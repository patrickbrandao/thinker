import type en from '../en/account.js';
import type { Catalog } from '../../types.js';

const ptBR: Catalog<typeof en> = {
  title: 'Preferências da conta',
  metaDescription: 'Gerencie seu perfil, workspace e preferências de tema.',
  subtitle: 'Seu perfil, os dados do workspace e as preferências de exibição',
  profile: {
    title: 'Informações do perfil',
    displayName: 'Nome de exibição',
    displayNameDesc: 'Nome mostrado em todo o painel.',
    email: 'E-mail',
    emailDesc: 'Usado para avisos da conta.',
    managedBy: 'As informações do perfil são gerenciadas pelo seu provedor de autenticação.',
  },
  security: {
    title: 'Segurança',
    currentPassword: 'Senha atual',
    currentPasswordDesc: 'Confirme a senha que você usa hoje.',
    newPassword: 'Nova senha',
    newPasswordDesc: 'No mínimo 8 caracteres.',
    confirmPassword: 'Confirme a nova senha',
    confirmPasswordDesc: 'Digite a nova senha de novo para confirmar.',
    submit: 'Alterar senha',
    mismatch: 'As novas senhas não coincidem',
    tooShort: 'A nova senha precisa ter no mínimo 8 caracteres',
    sameAsCurrent: 'A nova senha precisa ser diferente da atual',
    failed: 'Não foi possível alterar a senha',
    changed: 'Senha alterada. Os outros dispositivos foram desconectados.',
  },
  workspace: {
    title: 'Workspace',
    desc: 'O identificador único do seu workspace. Pode ser pedido em solicitações de suporte ou integrações avançadas.',
    copyId: 'Copiar ID do workspace',
  },
  appearance: {
    title: 'Aparência',
    desc: 'Escolha como o Thinker aparece para você.',
    light: 'Claro',
    dark: 'Escuro',
    system: 'Sistema',
  },
  language: {
    title: 'Idioma',
    desc: 'Escolha o idioma do painel. Fica salvo para o seu usuário neste navegador.',
    label: 'Idioma do painel',
  },
};

export default ptBR;
