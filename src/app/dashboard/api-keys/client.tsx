'use client';

import { useState, useTransition } from 'react';

type ApiKeyInfo = {
  id: string;
  prefix: string;
  name: string | null;
  planTier: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export function ApiKeysClient({
  initialKeys,
  createApiKey,
  revokeApiKey,
}: {
  initialKeys: ApiKeyInfo[];
  createApiKey: (name?: string) => Promise<{ key: string; prefix: string }>;
  revokeApiKey: (keyId: string) => Promise<void>;
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    startTransition(async () => {
      const result = await createApiKey();
      setNewKey(result.key);
      setCopied(false);
      // Refresh key list
      setKeys((prev) => [
        {
          id: 'new',
          prefix: result.prefix,
          name: 'Default Key',
          planTier: 'free',
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    });
  };

  const handleCopy = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = (keyId: string) => {
    startTransition(async () => {
      await revokeApiKey(keyId);
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    });
  };

  return (
    <div>
      {/* New key banner */}
      {newKey && (
        <div className="bg-[#F0EDE8] border border-[#D4CFC7] rounded-xl p-6 mb-6">
          <p className="text-sm font-medium text-[#2C2C2C] mb-2">
            Your new API key (copy it now — you won&apos;t see it again):
          </p>
          <div className="flex items-center gap-3">
            <code className="flex-1 bg-white px-4 py-2 rounded-lg font-mono text-sm text-[#2C2C2C] border border-[#E8E4DF] overflow-x-auto">
              {newKey}
            </code>
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-[#2C2C2C] text-white text-sm rounded-lg hover:bg-[#404040] transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleCreate}
        disabled={isPending}
        className="mb-8 px-5 py-2.5 bg-[#2C2C2C] text-white text-sm font-medium rounded-lg hover:bg-[#404040] transition-colors disabled:opacity-50"
      >
        {isPending ? 'Generating...' : 'Generate New Key'}
      </button>

      {/* Key list */}
      <div className="space-y-3">
        {keys.length === 0 && (
          <p className="text-[#6B6B6B] text-sm">No API keys yet. Generate one to get started.</p>
        )}
        {keys.map((key) => (
          <div
            key={key.id}
            className="bg-white rounded-xl border border-[#E8E4DF] p-4 flex items-center justify-between"
          >
            <div>
              <p className="font-mono text-sm text-[#2C2C2C]">
                {key.prefix}...
              </p>
              <p className="text-xs text-[#6B6B6B] mt-1">
                {key.name} &middot; {key.planTier} &middot; Created{' '}
                {new Date(key.createdAt).toLocaleDateString()}
                {key.lastUsedAt &&
                  ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
              </p>
            </div>
            <button
              onClick={() => handleRevoke(key.id)}
              disabled={isPending}
              className="text-sm text-red-600 hover:text-red-800 transition-colors disabled:opacity-50"
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
