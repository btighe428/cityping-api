import { listApiKeys, getMonthlyUsage, createApiKey, revokeApiKey } from './actions';
import { ApiKeysClient } from './client';

export default async function ApiKeysPage() {
  const [keys, usage] = await Promise.all([listApiKeys(), getMonthlyUsage()]);

  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold text-[#2C2C2C] mb-2">
          API Keys
        </h1>
        <p className="text-[#6B6B6B] mb-8">
          Manage your CityPing API keys. Use these to authenticate requests to
          the <code className="bg-[#F0EDE8] px-1.5 py-0.5 rounded text-sm">/api/v1/briefing</code> endpoint.
        </p>

        <div className="bg-white rounded-xl border border-[#E8E4DF] p-6 mb-8">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-[#6B6B6B]">API Calls This Month</span>
            <span className="text-2xl font-semibold text-[#2C2C2C]">
              {usage.toLocaleString()}
            </span>
          </div>
        </div>

        <ApiKeysClient
          initialKeys={keys}
          createApiKey={createApiKey}
          revokeApiKey={revokeApiKey}
        />
      </div>
    </div>
  );
}
