import React, { useState } from 'react';
import { Shield, Lock, ArrowLeft, ArrowRight, Save, Ban, Check, Zap, CheckCircle2, Plus, Search, Edit3, Trash2, Sliders, ExternalLink } from 'lucide-react';
import { type ScreenType, type WalletAdaItem, type WalletRailItem } from '../types.js';

interface ProvisionWalletAdaScreenProps {
  items: WalletAdaItem[];
  walletRails: WalletRailItem[];
  onSaveItem: (item: WalletAdaItem, isNew: boolean) => void;
  onDeleteItem: (id: string) => void;
  onNavigate: (screen: ScreenType) => void;
  onShowNotification: (msg: string) => void;
}

export const ProvisionWalletAdaScreen: React.FC<ProvisionWalletAdaScreenProps> = ({
  items,
  walletRails,
  onSaveItem,
  onDeleteItem,
  onNavigate,
  onShowNotification,
}) => {
  const [mode, setMode] = useState<'LIST' | 'FORM'>('LIST');
  const [editingItem, setEditingItem] = useState<WalletAdaItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Form State
  const [accountDisplayName, setAccountDisplayName] = useState('DeFi Market Maker Netting Compartment');
  const [denominationAsset, setDenominationAsset] = useState('USDC (On-Chain Digital Dollar)');
  const [settlementNetwork, setSettlementNetwork] = useState('Ethereum Mainnet (L1 Proof of Stake)');
  const [selectedWalletRail, setSelectedWalletRail] = useState(
    walletRails.length > 0
      ? `${walletRails[0].railId} (${walletRails[0].walletLabel})`
      : 'WLT-ETH-COLD-88 (Cold Storage Fireblocks Vault)'
  );
  const [allowTransfer, setAllowTransfer] = useState(true);
  const [allowPayment, setAllowPayment] = useState(true);

  const handleStartAddNew = () => {
    setEditingItem(null);
    setAccountDisplayName('');
    setDenominationAsset('USDC (On-Chain Digital Dollar)');
    setSettlementNetwork('Ethereum Mainnet (L1 Proof of Stake)');
    setSelectedWalletRail(
      walletRails.length > 0
        ? `${walletRails[0].railId} (${walletRails[0].walletLabel})`
        : 'WLT-ETH-COLD-88 (Cold Storage Fireblocks Vault)'
    );
    setAllowTransfer(true);
    setAllowPayment(true);
    setMode('FORM');
  };

  const handleStartEdit = (ada: WalletAdaItem) => {
    setEditingItem(ada);
    setAccountDisplayName(ada.accountDisplayName);
    setDenominationAsset(ada.denominationAsset);
    setSettlementNetwork(ada.settlementNetwork);
    setSelectedWalletRail(ada.selectedWalletRail);
    setAllowTransfer(ada.allowTransfer);
    setAllowPayment(ada.allowPayment);
    setMode('FORM');
  };

  const handleSaveDraft = () => {
    onShowNotification('Saved compartment specification draft to local session ledger.');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isNew = !editingItem;
    const randomSuffix = Math.floor(10 + Math.random() * 90);
    const boundRailObj = walletRails.find((r) => selectedWalletRail.includes(r.railId));
    const boundAddress = boundRailObj ? boundRailObj.destinationAddress : '0x98A179c3a4f89d4E7c1bA0D4f28E0124a98441F2';

    const itemToSave: WalletAdaItem = {
      id: editingItem ? editingItem.id : `ada-wlt-${Date.now()}`,
      accountId: editingItem ? editingItem.accountId : `ADA-8804-CW-${randomSuffix}`,
      accountDisplayName,
      denominationAsset,
      settlementNetwork,
      selectedWalletRail,
      boundAddress,
      balance: editingItem ? editingItem.balance : '0.00 USDC',
      allowTransfer,
      allowPayment,
      status: editingItem ? editingItem.status : 'ACTIVE_ON_LEDGER',
      isolationLevel: 'Tier-1 MPC Enclave',
      lastAttestation: '0x38b2...a901 (Block verified)',
    };

    onSaveItem(itemToSave, isNew);
    onShowNotification(
      isNew
        ? `Successfully provisioned Wallet ADA: ${accountDisplayName} [${itemToSave.accountId}]`
        : `Updated Wallet ADA: ${accountDisplayName}`
    );
    setMode('LIST');
  };

  const filteredItems = items.filter((item) => {
    return (
      item.accountDisplayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.accountId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.selectedWalletRail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.boundAddress.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="p-3 sm:p-4 lg:p-5 max-w-[1520px] mx-auto">
      {/* Top Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-[#757575] mb-2 pb-1.5 border-b border-[#e0e0e0] gap-1.5">
        <div className="flex items-center gap-2">
          <span className="hover:text-black cursor-pointer">Business Client Portal</span>
          <span>/</span>
          <span className="hover:text-black cursor-pointer">Accounts (ADA)</span>
          <span>/</span>
          <span className="text-black font-semibold">Encapsulated Wallet ADA Accounts</span>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode('LIST')}
            className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
              mode === 'LIST'
                ? 'bg-black text-white font-bold border-black'
                : 'bg-white text-[#666] border-[#d4d4d4] hover:border-black'
            }`}
          >
            List Overview ({items.length})
          </button>
          <button
            type="button"
            onClick={() => {
              if (mode === 'LIST') handleStartAddNew();
            }}
            className={`px-2 py-0.5 text-[10px] font-mono border transition-colors ${
              mode === 'FORM'
                ? 'bg-black text-white font-bold border-black'
                : 'bg-white text-[#666] border-[#d4d4d4] hover:border-black'
            }`}
          >
            {editingItem ? 'Edit ADA Form' : '+ Provision New Wallet ADA'}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODE 1: LIST VIEW                                                        */}
      {/* ========================================================================= */}
      {mode === 'LIST' && (
        <div className="space-y-3.5">
          {/* Header Block */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-caslon text-2xl sm:text-3xl text-black font-normal tracking-tight">
              Encapsulated Wallet ADA Accounts
            </h1>

            <button
              type="button"
              onClick={handleStartAddNew}
              className="bg-black hover:bg-[#222] text-white px-3.5 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-none"
            >
              <Plus className="w-3.5 h-3.5" />
              Provision New Wallet ADA
            </button>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Total Accounts</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">{items.length} Active</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Total USDC Liquidity</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">21,150,000.00</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Fiat Exposure</div>
              <div className="font-caslon text-xl font-bold text-[#10b981] mt-0.5">0.00% Zero</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">On-Chain State</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">100% Verified</div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white border border-[#e0e0e0] p-2.5">
            <div className="relative w-full max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#757575]" />
              <input
                type="text"
                placeholder="Search by compartment name, ADA ID, bound address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 border border-[#d4d4d4] text-xs font-mono text-black focus:outline-none focus:border-black"
              />
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-white border border-black overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-black bg-[#f5f5f5] text-[10px] font-mono uppercase text-[#555]">
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Compartment ID &amp; Name</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Denomination &amp; Chain</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Bound Wallet Rail &amp; Hex</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Current Balance</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Permitted Operations</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e0e0e0] font-mono text-[11px]">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#757575] font-mono">
                      No wallet ADA accounts found. Click &quot;Provision New Wallet ADA&quot; to allocate one.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((ada) => (
                    <tr key={ada.id} className="hover:bg-[#fafafa] transition-colors">
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="font-bold text-black flex items-center gap-1.5">
                          <span>{ada.accountId}</span>
                          <span className="w-1.5 h-1.5 bg-[#10b981] inline-block"></span>
                        </div>
                        <div className="font-franklin text-xs text-[#222] font-semibold">{ada.accountDisplayName}</div>
                        <div className="text-[9px] text-[#888]">{ada.isolationLevel}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="text-black font-semibold">{ada.denominationAsset}</div>
                        <div className="text-[10px] text-[#666]">{ada.settlementNetwork}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="text-black font-semibold">{ada.selectedWalletRail}</div>
                        <div className="text-[10px] font-mono text-[#757575] truncate max-w-[180px]">
                          {ada.boundAddress}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="font-caslon text-sm font-bold text-black">{ada.balance}</div>
                        <div className="text-[9px] text-[#10b981]">{ada.lastAttestation}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="flex flex-wrap gap-1">
                          {ada.allowTransfer && (
                            <span className="px-1.5 py-0.2 bg-[#e0f2fe] text-[#0369a1] border border-[#bae6fd] text-[9px] font-bold">
                              TRANSFER
                            </span>
                          )}
                          {ada.allowPayment && (
                            <span className="px-1.5 py-0.2 bg-[#fef3c7] text-[#92400e] border border-[#fde68a] text-[9px] font-bold">
                              PAYMENT
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(ada)}
                            title="Edit Compartment Parameters"
                            className="border border-black bg-white hover:bg-[#f0f0f0] text-black px-2 py-1 text-[10px] font-franklin font-bold uppercase tracking-wider flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onShowNotification(`Verified cryptographic Merkle root seal for ${ada.accountId}: 0 mutations.`);
                            }}
                            title="Audit Seal"
                            className="border border-[#d4d4d4] bg-[#fbfbfb] hover:border-black text-[#333] px-2 py-1 text-[10px] font-franklin font-semibold uppercase tracking-wider"
                          >
                            Seal
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Are you sure you want to de-provision ${ada.accountId}?`)) {
                                onDeleteItem(ada.id);
                                onShowNotification(`De-provisioned ${ada.accountId}`);
                              }
                            }}
                            title="De-provision"
                            className="p-1 text-[#ba1a1a] hover:bg-[#fee2e2] border border-transparent hover:border-[#fca5a5]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: FORM VIEW (ADD NEW OR EDIT EXISTING)                              */}
      {/* ========================================================================= */}
      {mode === 'FORM' && (
        <div>
          {/* Back Action Bar */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMode('LIST')}
                className="border border-black bg-white hover:bg-[#f5f5f5] text-black px-2.5 py-1 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Accounts List
              </button>
              <div>
                <h1 className="font-caslon text-2xl text-black font-normal tracking-tight">
                  {editingItem ? `Edit Encapsulated ADA: ${editingItem.accountId}` : 'Provision Encapsulated ADA: Wallet-Only Compartment'}
                </h1>
                <div className="text-[10px] font-mono text-[#757575] uppercase">
                  {editingItem ? `STATUS: ${editingItem.status} // ISOLATION: ${editingItem.isolationLevel}` : 'NEW ON-CHAIN CAPITAL PARTITION'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode('LIST')}
                className="border border-[#d4d4d4] bg-white hover:bg-[#f5f5f5] text-[#555] px-3 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                className="border border-black bg-white hover:bg-[#f5f5f5] text-black px-3 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                Save Draft
              </button>
            </div>
          </div>

          {/* Main Form Columns */}
          <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-3.5">
            {/* Left Column (7 cols): Identity & Denomination */}
            <div className="col-span-7 space-y-3.5">
              <div className="bg-white border border-[#e0e0e0] p-3.5 space-y-3">
                <div className="border-b border-black pb-1.5 mb-2">
                  <h2 className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Compartment Identity &amp; Denomination
                  </h2>
                </div>

                <div>
                  <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                    ADA Account Display Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={accountDisplayName}
                    onChange={(e) => setAccountDisplayName(e.target.value)}
                    className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                    placeholder="e.g. DeFi Market Maker Netting Compartment"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Denomination Asset
                    </label>
                    <input
                      type="text"
                      value={denominationAsset}
                      onChange={(e) => setDenominationAsset(e.target.value)}
                      className="w-full border border-[#d4d4d4] bg-[#f9f9f9] px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Settlement Network &amp; Chain <span className="text-red-600">*</span>
                    </label>
                    <select
                      value={settlementNetwork}
                      onChange={(e) => setSettlementNetwork(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none cursor-pointer"
                    >
                      <option value="Ethereum Mainnet (L1 Proof of Stake)">Ethereum Mainnet (L1 Proof of Stake)</option>
                      <option value="Arbitrum One (L2 Nitro Rollup)">Arbitrum One (L2 Nitro Rollup)</option>
                      <option value="Polygon Proof of Stake (L2)">Polygon Proof of Stake (L2)</option>
                      <option value="Base (L2 OP Stack)">Base (L2 OP Stack)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Bound Predefined Wallet Rail */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2 mb-2.5">
                  <label className="text-[10px] font-franklin font-bold uppercase tracking-wider text-black">
                    Bound Predefined Wallet Rail <span className="text-red-600">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onNavigate('REGISTER_WALLET_RAIL')}
                    className="text-[11px] text-[#057dbc] hover:underline font-franklin font-semibold"
                  >
                    (+ Register New Wallet Rail)
                  </button>
                </div>

                <select
                  value={selectedWalletRail}
                  onChange={(e) => setSelectedWalletRail(e.target.value)}
                  className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none cursor-pointer"
                >
                  {walletRails.map((rail) => (
                    <option key={rail.id} value={`${rail.railId} (${rail.walletLabel})`}>
                      {rail.railId} &mdash; {rail.walletLabel} ({rail.destinationAddress.slice(0, 10)}...)
                    </option>
                  ))}
                  {walletRails.length === 0 && (
                    <option value="WLT-ETH-COLD-88 (Cold Storage Vault)">
                      WLT-ETH-COLD-88 (Cold Storage Vault)
                    </option>
                  )}
                </select>
              </div>

              {/* Permitted Subtypes */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="border-b border-black pb-1.5 mb-2.5">
                  <h2 className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Permitted Movement Subtypes
                  </h2>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowTransfer}
                      onChange={(e) => setAllowTransfer(e.target.checked)}
                      className="h-4 w-4 border border-black accent-black rounded-none"
                    />
                    <span className="text-xs font-franklin text-black font-semibold">
                      Transfer Instruction (Intra-Entity Partition)
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowPayment}
                      onChange={(e) => setAllowPayment(e.target.checked)}
                      className="h-4 w-4 border border-black accent-black rounded-none"
                    />
                    <span className="text-xs font-franklin text-black font-semibold">
                      Payment Instruction (Counterparty Settlement)
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Right Column: Specimen Preview & Guarantees (5 cols) */}
            <div className="col-span-5 space-y-3.5">
              <div className="bg-white border border-black p-3.5">
                <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-black" />
                    <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-black">
                      Payload Preview
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-[#757575]">ON-CHAIN PARTITION</span>
                </div>

                <div className="bg-[#111] text-[#e0e0e0] font-mono text-[10px] p-3 border border-black overflow-x-auto space-y-1">
                  <div><span className="text-[#888]">{'{'}</span></div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;compartment_id&quot;</span>: <span className="text-white">&quot;{editingItem?.accountId || 'ADA-8804-CW-AUTOGEN'}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;display_name&quot;</span>: <span className="text-white">&quot;{accountDisplayName || 'Untitled'}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;denomination&quot;</span>: <span className="text-white">&quot;{denominationAsset}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;settlement_chain&quot;</span>: <span className="text-white">&quot;{settlementNetwork}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;bound_rail&quot;</span>: <span className="text-white">&quot;{selectedWalletRail}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;allow_transfer&quot;</span>: <span className="text-[#10b981]">{allowTransfer ? 'true' : 'false'}</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;allow_payment&quot;</span>: <span className="text-[#10b981]">{allowPayment ? 'true' : 'false'}</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;fiat_clearing_allowed&quot;</span>: <span className="text-[#ba1a1a]">false</span></div>
                  <div><span className="text-[#888]">{'}'}</span></div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  type="submit"
                  className="w-full bg-black hover:bg-[#222] text-white py-2 px-4 text-xs font-franklin font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-none"
                >
                  {editingItem ? 'Save Changes' : 'Provision Wallet ADA'}
                </button>

                <button
                  type="button"
                  onClick={() => setMode('LIST')}
                  className="w-full border border-black bg-white hover:bg-[#f5f5f5] text-black py-1.5 px-4 text-xs font-franklin font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
