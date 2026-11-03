/**
 * Padrão de segurança de senha exigido no cadastro e na redefinição de senha:
 * mínimo de 8 caracteres, com ao menos 1 maiúscula, 1 minúscula e 1 número.
 * Retorna a mensagem de erro para exibir, ou null se a senha atende ao padrão.
 */
export function describePasswordError(password) {
  const value = String(password ?? "");
  if (value.length < 8) return "A senha deve ter pelo menos 8 caracteres.";
  if (!/[A-Z]/.test(value)) return "A senha deve ter pelo menos uma letra maiúscula.";
  if (!/[a-z]/.test(value)) return "A senha deve ter pelo menos uma letra minúscula.";
  if (!/[0-9]/.test(value)) return "A senha deve ter pelo menos um número.";
  return null;
}
