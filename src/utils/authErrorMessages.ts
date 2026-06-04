export const getAuthErrorMessage = (
  error: unknown,
  fallback = '認証処理に失敗しました。しばらく待ってから再度お試しください。'
): string => {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes('email rate limit exceeded')) {
    return '認証メールの送信回数が上限に達しました。しばらく待ってから再度お試しください。';
  }

  if (normalized.includes('rate limit')) {
    return '短時間に操作が集中したため、一時的に制限されています。しばらく待ってから再度お試しください。';
  }

  if (normalized.includes('invalid login credentials')) {
    return 'メールアドレスまたはパスワードを確認してください。';
  }

  if (normalized.includes('password should be at least')) {
    return '新しいパスワードは8文字以上で入力してください。';
  }

  if (normalized.includes('email not confirmed')) {
    return 'メールアドレスの確認が完了していません。確認メールをご確認ください。';
  }

  return rawMessage || fallback;
};
