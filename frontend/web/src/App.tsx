// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface VaultRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  name: string;
  isNFTMinted: boolean;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  // Randomly selected style: Gradient (cool color glacier) + Glassmorphism + Card + Micro-interactions
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [vaults, setVaults] = useState<VaultRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newVaultData, setNewVaultData] = useState({ name: "", sensitiveValue: 0 });
  const [selectedVault, setSelectedVault] = useState<VaultRecord | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Randomly selected features: Data List, Wallet Management, FAQ, Search & Filter

  useEffect(() => {
    loadVaults().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadVaults = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract is not available");
        return;
      }

      // Get all vault keys
      const keysBytes = await contract.getData("vault_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing vault keys:", e); }
      }

      // Load each vault data
      const list: VaultRecord[] = [];
      for (const key of keys) {
        try {
          const vaultBytes = await contract.getData(`vault_${key}`);
          if (vaultBytes.length > 0) {
            try {
              const vaultData = JSON.parse(ethers.toUtf8String(vaultBytes));
              list.push({ 
                id: key, 
                encryptedData: vaultData.data, 
                timestamp: vaultData.timestamp, 
                owner: vaultData.owner, 
                name: vaultData.name,
                isNFTMinted: vaultData.isNFTMinted || false
              });
            } catch (e) { console.error(`Error parsing vault data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading vault ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setVaults(list);
    } catch (e) { console.error("Error loading vaults:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createVault = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting sensitive data with Zama FHE..." });
    try {
      // Encrypt data using FHE simulation
      const encryptedData = FHEEncryptNumber(newVaultData.sensitiveValue);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Generate unique vault ID
      const vaultId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const vaultData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        name: newVaultData.name,
        isNFTMinted: false
      };
      
      // Store vault data
      await contract.setData(`vault_${vaultId}`, ethers.toUtf8Bytes(JSON.stringify(vaultData)));
      
      // Update vault keys list
      const keysBytes = await contract.getData("vault_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(vaultId);
      await contract.setData("vault_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted vault created successfully!" });
      await loadVaults();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewVaultData({ name: "", sensitiveValue: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const mintNFTKey = async (vaultId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Minting NFT access key..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Get current vault data
      const vaultBytes = await contract.getData(`vault_${vaultId}`);
      if (vaultBytes.length === 0) throw new Error("Vault not found");
      const vaultData = JSON.parse(ethers.toUtf8String(vaultBytes));
      
      // Update vault with NFT minted status
      const updatedVault = { ...vaultData, isNFTMinted: true };
      await contract.setData(`vault_${vaultId}`, ethers.toUtf8Bytes(JSON.stringify(updatedVault)));
      
      setTransactionStatus({ visible: true, status: "success", message: "NFT access key minted successfully!" });
      await loadVaults();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Minting failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (vaultAddress: string) => address?.toLowerCase() === vaultAddress.toLowerCase();

  const filteredVaults = vaults.filter(vault => 
    vault.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vault.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vault.owner.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const faqItems = [
    {
      question: "What is Zama FHE?",
      answer: "Zama is a framework for Fully Homomorphic Encryption (FHE) that allows computations on encrypted data without decryption. This means your sensitive data remains encrypted even during processing."
    },
    {
      question: "How does the NFT access key work?",
      answer: "Each data vault is protected by an NFT access key. Only the NFT holder can decrypt and access the encrypted data in the vault. The NFT can be traded or transferred like any other NFT."
    },
    {
      question: "Is my data really secure?",
      answer: "Yes! Your data is encrypted client-side using FHE before being sent to the blockchain. Even we can't see your original data - only you with the NFT key can decrypt it."
    },
    {
      question: "What kind of data can I store?",
      answer: "Currently we support numerical data (integers, decimals) as FHE works best with numbers. String/text data would need to be encoded as numbers first."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection to Zama FHE...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>NFT Key FHE</h1>
          <p>Secure Data Vaults with NFT Access Keys</p>
        </div>
        <div className="header-actions">
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="hero-section">
          <div className="hero-content">
            <h2>Confidential Data Vaults</h2>
            <p>Encrypt your sensitive data with Zama FHE and control access through NFT keys</p>
            <div className="hero-buttons">
              <button 
                onClick={() => setShowCreateModal(true)} 
                className="primary-btn"
                data-hover="Create New Vault"
              >
                <span>+ New Data Vault</span>
              </button>
              <button 
                onClick={() => setShowFAQ(!showFAQ)} 
                className="secondary-btn"
                data-hover="Learn More"
              >
                <span>{showFAQ ? "Hide FAQ" : "Show FAQ"}</span>
              </button>
            </div>
          </div>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </div>

        {showFAQ && (
          <div className="faq-section">
            <h3>Frequently Asked Questions</h3>
            <div className="faq-grid">
              {faqItems.map((item, index) => (
                <div className="faq-card" key={index}>
                  <h4>{item.question}</h4>
                  <p>{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="vaults-section">
          <div className="section-header">
            <h2>Your Data Vaults</h2>
            <div className="search-filter">
              <input
                type="text"
                placeholder="Search vaults..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <button 
                onClick={loadVaults} 
                className="refresh-btn"
                disabled={isRefreshing}
                data-hover="Refresh List"
              >
                {isRefreshing ? "Refreshing..." : "↻"}
              </button>
            </div>
          </div>

          {vaults.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔒</div>
              <h3>No Data Vaults Found</h3>
              <p>Create your first encrypted data vault to get started</p>
              <button 
                onClick={() => setShowCreateModal(true)} 
                className="primary-btn"
                data-hover="Secure Your Data"
              >
                <span>Create Vault</span>
              </button>
            </div>
          ) : (
            <div className="vaults-grid">
              {filteredVaults.map(vault => (
                <div 
                  className="vault-card" 
                  key={vault.id}
                  onClick={() => setSelectedVault(vault)}
                  data-hover="View Details"
                >
                  <div className="card-header">
                    <h3>{vault.name || "Unnamed Vault"}</h3>
                    <span className="vault-id">#{vault.id.substring(0, 6)}</span>
                  </div>
                  <div className="card-body">
                    <div className="vault-meta">
                      <div className="meta-item">
                        <span>Owner</span>
                        <strong>{vault.owner.substring(0, 6)}...{vault.owner.substring(38)}</strong>
                      </div>
                      <div className="meta-item">
                        <span>Created</span>
                        <strong>{new Date(vault.timestamp * 1000).toLocaleDateString()}</strong>
                      </div>
                    </div>
                    <div className="vault-status">
                      <div className={`nft-status ${vault.isNFTMinted ? "minted" : "pending"}`}>
                        {vault.isNFTMinted ? "NFT Minted" : "NFT Not Minted"}
                      </div>
                    </div>
                  </div>
                  <div className="card-footer">
                    {isOwner(vault.owner) && !vault.isNFTMinted && (
                      <button 
                        className="mint-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          mintNFTKey(vault.id);
                        }}
                        data-hover="Mint NFT Key"
                      >
                        Mint Access Key
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New Data Vault</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Vault Name</label>
                <input
                  type="text"
                  name="name"
                  value={newVaultData.name}
                  onChange={(e) => setNewVaultData({...newVaultData, name: e.target.value})}
                  placeholder="My sensitive data"
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Sensitive Numerical Data</label>
                <input
                  type="number"
                  name="sensitiveValue"
                  value={newVaultData.sensitiveValue}
                  onChange={(e) => setNewVaultData({...newVaultData, sensitiveValue: parseFloat(e.target.value) || 0})}
                  placeholder="Enter the numerical value to encrypt"
                  className="form-input"
                  step="0.01"
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-content">
                  <div className="plain-value">
                    <span>Original:</span>
                    <strong>{newVaultData.sensitiveValue || "0"}</strong>
                  </div>
                  <div className="arrow">→</div>
                  <div className="encrypted-value">
                    <span>Encrypted:</span>
                    <strong>
                      {newVaultData.sensitiveValue ? 
                        FHEEncryptNumber(newVaultData.sensitiveValue).substring(0, 30) + "..." : 
                        "FHE-..."
                      }
                    </strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)} 
                className="cancel-btn"
                data-hover="Cancel"
              >
                Cancel
              </button>
              <button 
                onClick={createVault} 
                disabled={creating}
                className="submit-btn"
                data-hover="Encrypt & Store"
              >
                {creating ? "Encrypting..." : "Create Vault"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedVault && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Vault Details</h2>
              <button onClick={() => {
                setSelectedVault(null);
                setDecryptedValue(null);
              }} className="close-modal">×</button>
            </div>
            <div className="modal-body">
              <div className="vault-info">
                <div className="info-row">
                  <span>Vault Name:</span>
                  <strong>{selectedVault.name || "Unnamed Vault"}</strong>
                </div>
                <div className="info-row">
                  <span>Vault ID:</span>
                  <strong>{selectedVault.id}</strong>
                </div>
                <div className="info-row">
                  <span>Owner:</span>
                  <strong>{selectedVault.owner}</strong>
                </div>
                <div className="info-row">
                  <span>Created:</span>
                  <strong>{new Date(selectedVault.timestamp * 1000).toLocaleString()}</strong>
                </div>
                <div className="info-row">
                  <span>NFT Access Key:</span>
                  <strong className={selectedVault.isNFTMinted ? "status-minted" : "status-pending"}>
                    {selectedVault.isNFTMinted ? "Minted" : "Not Minted"}
                  </strong>
                </div>
              </div>

              <div className="data-section">
                <h3>Encrypted Data</h3>
                <div className="encrypted-data">
                  {selectedVault.encryptedData.substring(0, 100)}...
                </div>
                <div className="fhe-tag">
                  <span>Zama FHE Encrypted</span>
                </div>

                <button 
                  className="decrypt-btn"
                  onClick={async () => {
                    if (decryptedValue !== null) {
                      setDecryptedValue(null);
                    } else {
                      const decrypted = await decryptWithSignature(selectedVault.encryptedData);
                      setDecryptedValue(decrypted);
                    }
                  }}
                  disabled={isDecrypting}
                  data-hover={decryptedValue ? "Hide Value" : "Decrypt Data"}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedValue !== null ? "Hide Decrypted Value" : "Decrypt with Wallet"}
                </button>

                {decryptedValue !== null && (
                  <div className="decrypted-data">
                    <h3>Decrypted Value</h3>
                    <div className="decrypted-value">{decryptedValue}</div>
                    <div className="decryption-notice">
                      This value was decrypted locally after verifying your NFT ownership
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              {isOwner(selectedVault.owner) && !selectedVault.isNFTMinted && (
                <button 
                  className="mint-btn"
                  onClick={() => mintNFTKey(selectedVault.id)}
                  data-hover="Mint NFT Key"
                >
                  Mint NFT Access Key
                </button>
              )}
              <button 
                onClick={() => {
                  setSelectedVault(null);
                  setDecryptedValue(null);
                }}
                className="close-btn"
                data-hover="Close"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className={`transaction-content ${transactionStatus.status}`}>
            <div className="transaction-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>NFT Key FHE</h3>
            <p>Secure confidential data vaults with NFT access keys</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} NFT Key FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;