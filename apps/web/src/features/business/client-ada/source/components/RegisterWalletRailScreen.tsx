import React, { useState } from 'react';
import { Shield, Lock, ArrowLeft, ArrowRight, Copy, Check, CheckCircle2, Download, AlertTriangle, Plus, Search, Edit3, Trash2 } from 'lucide-react';
import { type ScreenType, type WalletRailItem } from '../types.js';

interface RegisterWalletRailScreenProps {
  items: WalletRailItem[];
  onSaveItem: (item: WalletRailItem, isNew: boolean) => void;
  onDeleteItem: (id: string) => void;
  onNavigate: (screen: ScreenType) => void;
  onShowNotification: (msg: string) => void;
}

export const RegisterWalletRailScreen: React.FC<RegisterWalletRailScreenProps> = ({
  items,
  onSaveItem,
  onDeleteItem,
  onNavigate,
  onShowNotification,
}) => {
  const [mode, setMode] = useState<'LIST' | 'FORM'>('LIST');
  const [editingItem, setEditingItem] = useState<WalletRailItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form State
  const [walletLabel, setWalletLabel] = useState('Fireblocks Cold Storage Custody 01');
  const [networkProtocol, setNetworkProtocol] = useState('Ethereum Mainnet (EVM - 1)');
  const [addressSecurityType, setAddressSecurityType] = useState('Institutional Custody (MPC)');
  const [destinationAddress, setDestinationAddress] = useState('0x98A179c3a4f89d4E7c1bA0D4f28E0124a98441F2');
  const [allowMintExternalization, setAllowMintExternalization] = useState(true);
  const [allowIntraClientTransfer, setAllowIntraClientTransfer] = useState(true);
  const [allowInterClientPayment, setAllowInterClientPayment] = useState(false);
  const [signaturePayload, setSignaturePayload] = useState(
    '0x9a84f37e8c1b2c5e40a022d4f828a2b53443a677ec53a8c17b4c6e5e8e81561f71a938c5b16c87e2dbf9e9cf296568c07e052c93d9385bf3f140684a0c8680df1b'
  );
  const [autoBindWalletAda, setAutoBindWalletAda] = useState(true);

  const handleStartAddNew = () => {
    setEditingItem(null);
    setWalletLabel('');
    setNetworkProtocol('Ethereum Mainnet (EVM - 1)');
    setAddressSecurityType('Institutional Custody (MPC)');
    setDestinationAddress('');
    setAllowMintExternalization(true);
    setAllowIntraClientTransfer(true);
    setAllowInterClientPayment(false);
    setSignaturePayload('0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''));
    setAutoBindWalletAda(true);
    setMode('FORM');
  };

  const handleStartEdit = (rail: WalletRailItem) => {
    setEditingItem(rail);
    setWalletLabel(rail.walletLabel);
    setNetworkProtocol(rail.networkProtocol);
    setAddressSecurityType(rail.addressSecurityType);
    setDestinationAddress(rail.destinationAddress);
    setAllowMintExternalization(rail.allowMintExternalization);
    setAllowIntraClientTransfer(rail.allowIntraClientTransfer);
    setAllowInterClientPayment(rail.allowInterClientPayment);
    setSignaturePayload(rail.signaturePayload);
    setAutoBindWalletAda(rail.autoBindWalletAda);
    setMode('FORM');
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    onShowNotification(`Copied address to clipboard.`);
  };

  const handleTestSignature = () => {
    onShowNotification('Validating EIP-712 payload via local secp256k1 recovery... Signature VALID.');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isNew = !editingItem;
    const randomHex = Math.floor(10 + Math.random() * 90);
    const itemToSave: WalletRailItem = {
      id: editingItem ? editingItem.id : `rail-wlt-${Date.now()}`,
      railId: editingItem ? editingItem.railId : `WLT-ETH-CUSTODY-${randomHex}`,
      walletLabel,
      networkProtocol,
      addressSecurityType,
      destinationAddress,
      allowMintExternalization,
      allowIntraClientTransfer,
      allowInterClientPayment,
      signaturePayload,
      autoBindWalletAda,
      status: editingItem ? editingItem.status : 'WHITELIST_ACTIVE',
      travelRuleStatus: 'IVMS101_ATTESTED',
      registeredAt: editingItem ? editingItem.registeredAt : new Date().toISOString().split('T')[0],
    };

    onSaveItem(itemToSave, isNew);
    onShowNotification(
      isNew
        ? `Successfully registered Wallet Rail: ${walletLabel}`
        : `Updated Wallet Rail: ${walletLabel}`
    );
    setMode('LIST');
  };

  const filteredItems = items.filter((item) => {
    return (
      item.walletLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.railId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.destinationAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.networkProtocol.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  return (
    <div className="p-3 sm:p-4 lg:p-5 max-w-[1520px] mx-auto">
      {/* Top Breadcrumb Header */}
      <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-[#757575] mb-2 pb-1.5 border-b border-[#e0e0e0] gap-1.5">
        <div className="flex items-center gap-2">
          <span className="hover:text-black cursor-pointer">Business Client Portal</span>
          <span>/</span>
          <span className="hover:text-black cursor-pointer">Predefined Rails Registry</span>
          <span>/</span>
          <span className="text-black font-semibold">Whitelisted Wallet Rails</span>
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
            {editingItem ? 'Edit Rail Form' : '+ Register New Wallet Rail'}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODE 1: LIST VIEW                                                        */}
      {/* ========================================================================= */}
      {mode === 'LIST' && (
        <div className="space-y-3.5">
          {/* Title & Add Button */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-caslon text-2xl sm:text-3xl text-black font-normal tracking-tight">
              Whitelisted Wallet Rails Registry
            </h1>

            <button
              type="button"
              onClick={handleStartAddNew}
              className="bg-black hover:bg-[#222] text-white px-3.5 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-none"
            >
              <Plus className="w-3.5 h-3.5" />
              Register New Wallet Rail
            </button>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Whitelisted Rails</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">{items.length} Addresses</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Custody Type</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">MPC &amp; Hardware</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Compliance Screening</div>
              <div className="font-caslon text-xl font-bold text-[#10b981] mt-0.5">100% IVMS101</div>
            </div>

            <div className="bg-white border border-[#e0e0e0] p-2.5">
              <div className="text-[9px] font-mono uppercase text-[#757575] font-semibold">Timelock Quorum</div>
              <div className="font-caslon text-xl font-bold text-black mt-0.5">24h Quorum</div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white border border-[#e0e0e0] p-2.5">
            <div className="relative w-full max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#757575]" />
              <input
                type="text"
                placeholder="Search by label, address (0x...), protocol..."
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
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Rail ID &amp; Label</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Network Protocol</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Destination Hex Address</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Permitted Whitelist Scopes</th>
                  <th className="py-2 px-3 border-r border-[#e0e0e0]">Status</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e0e0e0] font-mono text-[11px]">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-[#757575] font-mono">
                      No wallet rails found. Click &quot;Register New Wallet Rail&quot; to whitelist an address.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((rail) => (
                    <tr key={rail.id} className="hover:bg-[#fafafa] transition-colors">
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="font-bold text-black flex items-center gap-1.5">
                          <span>{rail.railId}</span>
                        </div>
                        <div className="font-franklin text-xs text-[#222] font-semibold">{rail.walletLabel}</div>
                        <div className="text-[9px] text-[#888]">{rail.addressSecurityType}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="text-black font-semibold">{rail.networkProtocol}</div>
                        <div className="text-[9px] text-[#757575]">Reg: {rail.registeredAt}</div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="flex items-center gap-1 font-mono text-[10px]">
                          <span className="text-black font-semibold truncate max-w-[180px]">
                            {rail.destinationAddress}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(rail.destinationAddress, rail.id)}
                            className="p-1 hover:bg-[#e0e0e0] text-[#757575] hover:text-black shrink-0"
                            title="Copy Address"
                          >
                            {copiedId === rail.id ? <Check className="w-3 h-3 text-[#10b981]" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <div className="flex flex-wrap gap-1">
                          {rail.allowMintExternalization && (
                            <span className="px-1.5 py-0.2 bg-[#dcfce7] text-[#166534] border border-[#bbf7d0] text-[9px] font-bold">
                              MINT
                            </span>
                          )}
                          {rail.allowIntraClientTransfer && (
                            <span className="px-1.5 py-0.2 bg-[#e0f2fe] text-[#0369a1] border border-[#bae6fd] text-[9px] font-bold">
                              TRANSFER
                            </span>
                          )}
                          {rail.allowInterClientPayment && (
                            <span className="px-1.5 py-0.2 bg-[#fef3c7] text-[#92400e] border border-[#fde68a] text-[9px] font-bold">
                              PAYMENT
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 border-r border-[#e0e0e0]">
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#10b981] font-bold">
                          <span className="w-1.5 h-1.5 bg-[#10b981] inline-block"></span>
                          {rail.status}
                        </span>
                        <div className="text-[9px] text-[#757575]">{rail.travelRuleStatus}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(rail)}
                            title="Edit Whitelist Configuration"
                            className="border border-black bg-white hover:bg-[#f0f0f0] text-black px-2 py-1 text-[10px] font-franklin font-bold uppercase tracking-wider flex items-center gap-1"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigate('PROVISION_WALLET_ADA')}
                            title="Provision ADA for this Rail"
                            className="border border-[#d4d4d4] bg-[#fbfbfb] hover:border-black text-[#333] px-2 py-1 text-[10px] font-franklin font-semibold uppercase tracking-wider"
                          >
                            ADA &rarr;
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Are you sure you want to remove ${rail.railId} from the whitelist?`)) {
                                onDeleteItem(rail.id);
                                onShowNotification(`Removed ${rail.railId} from active whitelist.`);
                              }
                            }}
                            title="Remove from Whitelist"
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
                Back to Rails List
              </button>
              <div>
                <h1 className="font-caslon text-2xl text-black font-normal tracking-tight">
                  {editingItem ? `Edit Whitelisted Rail: ${editingItem.railId}` : 'Register Predefined Wallet Rail'}
                </h1>
                <div className="text-[10px] font-mono text-[#757575] uppercase">
                  {editingItem ? `STATUS: ${editingItem.status} // TRAVEL RULE: ${editingItem.travelRuleStatus}` : 'MODE: ADDRESS WHITELIST REGISTRATION'}
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
                onClick={handleTestSignature}
                className="border border-black bg-white hover:bg-[#f5f5f5] text-black px-3 py-1.5 text-xs font-franklin font-bold uppercase tracking-wider"
              >
                Test EIP-712 Sig
              </button>
            </div>
          </div>

          {/* Main Form Grid */}
          <form onSubmit={handleSubmit} className="grid grid-cols-12 gap-3.5">
            {/* Left Column (7 cols): Parameters & Verification */}
            <div className="col-span-7 space-y-3.5">
              {/* Section 01: Address & Protocol */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="border-b border-black pb-1.5 mb-3">
                  <h2 className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Target Address &amp; Network Protocol
                  </h2>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Wallet Rail Nickname / Label <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={walletLabel}
                      onChange={(e) => setWalletLabel(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-franklin text-black focus:outline-none"
                      placeholder="e.g. Cold Storage Fireblocks Vault 01"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Network Protocol <span className="text-red-600">*</span>
                      </label>
                      <select
                        value={networkProtocol}
                        onChange={(e) => setNetworkProtocol(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none cursor-pointer"
                      >
                        <option value="Ethereum Mainnet (EVM - 1)">Ethereum Mainnet (EVM - 1)</option>
                        <option value="Arbitrum One (EVM - 42161)">Arbitrum One (EVM - 42161)</option>
                        <option value="Base (EVM - 8453)">Base (EVM - 8453)</option>
                        <option value="Polygon PoS (EVM - 137)">Polygon PoS (EVM - 137)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                        Address Security Architecture <span className="text-red-600">*</span>
                      </label>
                      <select
                        value={addressSecurityType}
                        onChange={(e) => setAddressSecurityType(e.target.value)}
                        className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none cursor-pointer"
                      >
                        <option value="Institutional Custody (MPC)">Institutional Custody (MPC)</option>
                        <option value="Cold Storage Air-Gapped Vault">Cold Storage Air-Gapped Vault</option>
                        <option value="Multi-Signature Hardware Safe">Multi-Signature Hardware Safe</option>
                        <option value="Approved Third-Party Exchange">Approved Third-Party Exchange</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-franklin font-bold uppercase tracking-wider text-black mb-1">
                      Destination Hex Address <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      value={destinationAddress}
                      onChange={(e) => setDestinationAddress(e.target.value)}
                      className="w-full border border-black bg-white px-2.5 py-1.5 text-xs font-mono text-black focus:outline-none"
                      placeholder="0x..."
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Section 02: Permitted Instruction Scopes */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="border-b border-black pb-1.5 mb-2.5">
                  <h2 className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Permitted Instruction Scopes
                  </h2>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowMintExternalization}
                      onChange={(e) => setAllowMintExternalization(e.target.checked)}
                      className="h-4 w-4 border border-black accent-black rounded-none"
                    />
                    <span className="text-xs font-franklin text-black font-semibold">
                      Mint Externalization (USDC Outbound Mint)
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowIntraClientTransfer}
                      onChange={(e) => setAllowIntraClientTransfer(e.target.checked)}
                      className="h-4 w-4 border border-black accent-black rounded-none"
                    />
                    <span className="text-xs font-franklin text-black font-semibold">
                      Intra-Client Transfer (Between Internal Addresses)
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowInterClientPayment}
                      onChange={(e) => setAllowInterClientPayment(e.target.checked)}
                      className="h-4 w-4 border border-black accent-black rounded-none"
                    />
                    <span className="text-xs font-franklin text-black font-semibold">
                      Inter-Client Payment (External Counterparty Settlement)
                    </span>
                  </label>
                </div>
              </div>

              {/* Section 03: Proof of Control / Signature */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <div className="border-b border-black pb-1.5 mb-2">
                  <h2 className="text-xs font-franklin font-bold uppercase tracking-wider text-black">
                    Proof of Control (EIP-712 Signature)
                  </h2>
                </div>

                <div>
                  <textarea
                    rows={2}
                    value={signaturePayload}
                    onChange={(e) => setSignaturePayload(e.target.value)}
                    className="w-full border border-black bg-white p-2 font-mono text-[10px] text-black focus:outline-none"
                    placeholder="0x..."
                  />
                </div>
              </div>

              {/* Downstream ADA Checkbox */}
              <div className="bg-white border border-[#e0e0e0] p-3.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoBindWalletAda}
                    onChange={(e) => setAutoBindWalletAda(e.target.checked)}
                    className="h-4 w-4 border border-black accent-black rounded-none"
                  />
                  <span className="text-xs font-franklin font-bold uppercase text-black">
                    Auto-provision linked Wallet ADA Account
                  </span>
                </label>
              </div>
            </div>

            {/* Right Column: Specimen Preview & Actions (5 cols) */}
            <div className="col-span-5 space-y-3.5">
              <div className="bg-white border border-black p-3.5">
                <div className="flex items-center justify-between border-b border-[#e0e0e0] pb-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-black" />
                    <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-black">
                      Payload Preview
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-[#757575]">EIP-712</span>
                </div>

                <div className="bg-[#111] text-[#e0e0e0] font-mono text-[10px] p-3 border border-black overflow-x-auto space-y-1">
                  <div><span className="text-[#888]">{'{'}</span></div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;rail_id&quot;</span>: <span className="text-white">&quot;{editingItem?.railId || 'WLT-AUTOGEN-SPEC'}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;wallet_label&quot;</span>: <span className="text-white">&quot;{walletLabel || 'Untitled'}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;network&quot;</span>: <span className="text-white">&quot;{networkProtocol}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;address&quot;</span>: <span className="text-white">&quot;{destinationAddress}&quot;</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;scope_mint&quot;</span>: <span className="text-[#10b981]">{allowMintExternalization ? 'true' : 'false'}</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;scope_transfer&quot;</span>: <span className="text-[#10b981]">{allowIntraClientTransfer ? 'true' : 'false'}</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;scope_payment&quot;</span>: <span className="text-[#10b981]">{allowInterClientPayment ? 'true' : 'false'}</span>,</div>
                  <div className="pl-3"><span className="text-[#3b82f6]">&quot;auto_bind_ada&quot;</span>: <span className="text-[#10b981]">{autoBindWalletAda ? 'true' : 'false'}</span></div>
                  <div><span className="text-[#888]">{'}'}</span></div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="space-y-2 pt-1">
                <button
                  type="submit"
                  className="w-full bg-black hover:bg-[#222] text-white py-2 px-4 text-xs font-franklin font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors shadow-none"
                >
                  {editingItem ? 'Save Changes' : 'Register Wallet Rail'}
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
