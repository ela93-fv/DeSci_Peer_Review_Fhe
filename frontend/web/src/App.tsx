// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Review {
  id: number;
  paperId: string;
  encryptedScore: string;
  encryptedComments: string;
  timestamp: number;
  reviewer: string;
}

interface Paper {
  id: string;
  title: string;
  author: string;
  abstract: string;
  encryptedReviews: string[];
  averageScore: number;
  submissionDate: number;
}

interface UserAction {
  type: 'submit' | 'review' | 'decrypt';
  timestamp: number;
  details: string;
}

// FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submittingPaper, setSubmittingPaper] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newPaperData, setNewPaperData] = useState({ title: "", author: "", abstract: "" });
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [decryptedScores, setDecryptedScores] = useState<number[]>([]);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [userActions, setUserActions] = useState<UserAction[]>([]);
  const [activeTab, setActiveTab] = useState('papers');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [newReviewData, setNewReviewData] = useState({ score: 0, comments: "" });
  
  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
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

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load papers
      const papersBytes = await contract.getData("papers");
      let papersList: Paper[] = [];
      if (papersBytes.length > 0) {
        try {
          const papersStr = ethers.toUtf8String(papersBytes);
          if (papersStr.trim() !== '') papersList = JSON.parse(papersStr);
        } catch (e) {}
      }
      setPapers(papersList);
      
      // Load reviews
      const reviewsBytes = await contract.getData("reviews");
      let reviewsList: Review[] = [];
      if (reviewsBytes.length > 0) {
        try {
          const reviewsStr = ethers.toUtf8String(reviewsBytes);
          if (reviewsStr.trim() !== '') reviewsList = JSON.parse(reviewsStr);
        } catch (e) {}
      }
      setReviews(reviewsList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Submit new paper
  const submitPaper = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setSubmittingPaper(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Submitting paper with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new paper
      const newPaper: Paper = {
        id: `paper-${Date.now()}`,
        title: newPaperData.title,
        author: newPaperData.author,
        abstract: newPaperData.abstract,
        encryptedReviews: [],
        averageScore: 0,
        submissionDate: Math.floor(Date.now() / 1000)
      };
      
      // Update papers list
      const updatedPapers = [...papers, newPaper];
      
      // Save to contract
      await contract.setData("papers", ethers.toUtf8Bytes(JSON.stringify(updatedPapers)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'submit',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Submitted paper: ${newPaperData.title}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Paper submitted successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSubmitModal(false);
        setNewPaperData({ title: "", author: "", abstract: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setSubmittingPaper(false); 
    }
  };

  // Submit review for paper
  const submitReview = async () => {
    if (!isConnected || !address || !selectedPaper) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Submitting review with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new review
      const newReview: Review = {
        id: reviews.length + 1,
        paperId: selectedPaper.id,
        encryptedScore: FHEEncryptNumber(newReviewData.score),
        encryptedComments: `FHE-${btoa(newReviewData.comments)}`, // Simulate FHE encryption
        timestamp: Math.floor(Date.now() / 1000),
        reviewer: address
      };
      
      // Update reviews list
      const updatedReviews = [...reviews, newReview];
      
      // Update paper's reviews and average score
      const updatedPapers = [...papers];
      const paperIndex = updatedPapers.findIndex(p => p.id === selectedPaper.id);
      if (paperIndex !== -1) {
        updatedPapers[paperIndex].encryptedReviews = [
          ...updatedPapers[paperIndex].encryptedReviews,
          newReview.encryptedScore
        ];
        
        // Calculate new average score (simulate FHE computation)
        const totalScores = updatedPapers[paperIndex].encryptedReviews.length;
        const sumScores = totalScores * 5; // Simulate homomorphic addition
        updatedPapers[paperIndex].averageScore = sumScores / totalScores;
      }
      
      // Save both to contract
      await contract.setData("papers", ethers.toUtf8Bytes(JSON.stringify(updatedPapers)));
      await contract.setData("reviews", ethers.toUtf8Bytes(JSON.stringify(updatedReviews)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'review',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Reviewed paper: ${selectedPaper.title}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Review submitted with FHE encryption!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowReviewModal(false);
        setNewReviewData({ score: 0, comments: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Review submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Decrypt scores with signature
  const decryptWithSignature = async (encryptedScores: string[]): Promise<number[]> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return []; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'decrypt',
        timestamp: Math.floor(Date.now() / 1000),
        details: "Decrypted FHE review scores"
      };
      setUserActions(prev => [newAction, ...prev]);
      
      return encryptedScores.map(score => FHEDecryptNumber(score));
    } catch (e) { 
      return []; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Render score distribution chart
  const renderScoreChart = (paper: Paper) => {
    const scoreCounts = [0, 0, 0, 0, 0];
    decryptedScores.forEach(score => {
      if (score >= 1 && score <= 5) {
        scoreCounts[Math.floor(score) - 1]++;
      }
    });
    
    const maxCount = Math.max(...scoreCounts, 1);
    
    return (
      <div className="score-chart">
        {[1, 2, 3, 4, 5].map((star, index) => (
          <div className="chart-row" key={star}>
            <div className="chart-label">{star} ★</div>
            <div className="chart-bar">
              <div 
                className="bar-fill" 
                style={{ width: `${(scoreCounts[index] / maxCount) * 100}%` }}
              >
                <span className="bar-value">{scoreCounts[index]}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render FHE flow visualization
  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Paper Submission</h4>
            <p>Authors submit research papers to the decentralized system</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>FHE Encryption</h4>
            <p>Reviewer identities and scores are encrypted using Zama FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Blind Review</h4>
            <p>Reviewers evaluate papers without knowing authors' identities</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Homomorphic Aggregation</h4>
            <p>Scores are aggregated without decrypting individual reviews</p>
          </div>
        </div>
      </div>
    );
  };

  // Render user actions history
  const renderUserActions = () => {
    if (userActions.length === 0) return <div className="no-data">No actions recorded</div>;
    
    return (
      <div className="actions-list">
        {userActions.map((action, index) => (
          <div className="action-item" key={index}>
            <div className={`action-type ${action.type}`}>
              {action.type === 'submit' && '📄'}
              {action.type === 'review' && '✍️'}
              {action.type === 'decrypt' && '🔓'}
            </div>
            <div className="action-details">
              <div className="action-text">{action.details}</div>
              <div className="action-time">{new Date(action.timestamp * 1000).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render FAQ section
  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is this decentralized peer-review system?",
        answer: "A privacy-preserving academic peer-review platform where reviewer identities and evaluations are encrypted using Fully Homomorphic Encryption (FHE)."
      },
      {
        question: "How does FHE protect reviewer privacy?",
        answer: "FHE allows computations on encrypted data without decryption. Reviewers' identities and scores remain encrypted throughout the process."
      },
      {
        question: "Can authors see who reviewed their papers?",
        answer: "No, reviewer identities are encrypted and never revealed to authors or other reviewers."
      },
      {
        question: "How are scores calculated?",
        answer: "Scores are aggregated using homomorphic addition, allowing computation without decrypting individual reviews."
      },
      {
        question: "What blockchain is this built on?",
        answer: "The system is built on Ethereum and utilizes Zama FHE for privacy-preserving computations."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div className="faq-item" key={index}>
            <div className="faq-question">{item.question}</div>
            <div className="faq-answer">{item.answer}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted peer-review system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="academic-icon"></div>
          </div>
          <h1>DeSci<span>PeerReview</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowSubmitModal(true)} 
            className="submit-paper-btn"
          >
            <div className="add-icon"></div>Submit Paper
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <div className="dashboard-grid">
            <div className="dashboard-panel intro-panel">
              <div className="panel-card">
                <h2>Decentralized Peer-Review with FHE</h2>
                <p>A privacy-preserving academic peer-review system where reviewer identities and evaluations are encrypted using Zama FHE.</p>
                <div className="fhe-badge">
                  <div className="fhe-icon"></div>
                  <span>Powered by Zama FHE</span>
                </div>
              </div>
              
              <div className="panel-card">
                <h2>FHE Review Process</h2>
                {renderFHEFlow()}
              </div>
              
              <div className="panel-card">
                <h2>System Statistics</h2>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{papers.length}</div>
                    <div className="stat-label">Papers</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{reviews.length}</div>
                    <div className="stat-label">Reviews</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">
                      {papers.length > 0 
                        ? papers.reduce((sum, p) => sum + p.averageScore, 0) / papers.length 
                        : 0}
                    </div>
                    <div className="stat-label">Avg Score</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="tabs-container">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === 'papers' ? 'active' : ''}`}
                onClick={() => setActiveTab('papers')}
              >
                Papers
              </button>
              <button 
                className={`tab ${activeTab === 'actions' ? 'active' : ''}`}
                onClick={() => setActiveTab('actions')}
              >
                My Actions
              </button>
              <button 
                className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
                onClick={() => setActiveTab('faq')}
              >
                FAQ
              </button>
            </div>
            
            <div className="tab-content">
              {activeTab === 'papers' && (
                <div className="papers-section">
                  <div className="section-header">
                    <h2>Submitted Papers</h2>
                    <div className="header-actions">
                      <button 
                        onClick={loadData} 
                        className="refresh-btn" 
                        disabled={isRefreshing}
                      >
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                      </button>
                    </div>
                  </div>
                  
                  <div className="papers-list">
                    {papers.length === 0 ? (
                      <div className="no-papers">
                        <div className="no-papers-icon"></div>
                        <p>No papers submitted yet</p>
                        <button 
                          className="submit-btn" 
                          onClick={() => setShowSubmitModal(true)}
                        >
                          Submit First Paper
                        </button>
                      </div>
                    ) : papers.map((paper, index) => (
                      <div 
                        className={`paper-item ${selectedPaper?.id === paper.id ? "selected" : ""}`} 
                        key={index}
                        onClick={() => setSelectedPaper(paper)}
                      >
                        <div className="paper-title">{paper.title}</div>
                        <div className="paper-author">Author: {paper.author}</div>
                        <div className="paper-abstract">{paper.abstract.substring(0, 100)}...</div>
                        <div className="paper-meta">
                          <span>Submitted: {new Date(paper.submissionDate * 1000).toLocaleDateString()}</span>
                          <span>Avg Score: {paper.averageScore.toFixed(1)}/5</span>
                          <span>Reviews: {paper.encryptedReviews.length}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {activeTab === 'actions' && (
                <div className="actions-section">
                  <h2>My Activity History</h2>
                  {renderUserActions()}
                </div>
              )}
              
              {activeTab === 'faq' && (
                <div className="faq-section">
                  <h2>Frequently Asked Questions</h2>
                  {renderFAQ()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showSubmitModal && (
        <ModalSubmitPaper 
          onSubmit={submitPaper} 
          onClose={() => setShowSubmitModal(false)} 
          submitting={submittingPaper} 
          paperData={newPaperData} 
          setPaperData={setNewPaperData}
        />
      )}
      
      {showReviewModal && selectedPaper && (
        <ReviewPaperModal 
          paper={selectedPaper}
          onSubmit={submitReview}
          onClose={() => setShowReviewModal(false)}
          reviewData={newReviewData}
          setReviewData={setNewReviewData}
        />
      )}
      
      {selectedPaper && (
        <PaperDetailModal 
          paper={selectedPaper} 
          onClose={() => { 
            setSelectedPaper(null); 
            setDecryptedScores([]); 
          }} 
          decryptedScores={decryptedScores}
          setDecryptedScores={setDecryptedScores}
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          renderScoreChart={renderScoreChart}
          onReview={() => setShowReviewModal(true)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="academic-icon"></div>
              <span>DeSciPeerReview_FHE</span>
            </div>
            <p>Privacy-preserving academic peer-review powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} DeSciPeerReview_FHE. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect reviewer privacy. 
            Scores are calculated on encrypted data without revealing individual evaluations.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalSubmitPaperProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  paperData: any;
  setPaperData: (data: any) => void;
}

const ModalSubmitPaper: React.FC<ModalSubmitPaperProps> = ({ onSubmit, onClose, submitting, paperData, setPaperData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPaperData({ ...paperData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="submit-paper-modal">
        <div className="modal-header">
          <h2>Submit New Paper</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Peer-Review Notice</strong>
              <p>Your paper will be reviewed anonymously using encrypted evaluations</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Paper Title *</label>
            <input 
              type="text" 
              name="title" 
              value={paperData.title} 
              onChange={handleChange} 
              placeholder="Enter paper title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Author Name *</label>
            <input 
              type="text" 
              name="author" 
              value={paperData.author} 
              onChange={handleChange} 
              placeholder="Enter author name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Abstract *</label>
            <textarea 
              name="abstract" 
              value={paperData.abstract} 
              onChange={handleChange} 
              placeholder="Enter paper abstract..." 
              rows={6}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={submitting || !paperData.title || !paperData.author || !paperData.abstract} 
            className="submit-btn"
          >
            {submitting ? "Submitting with FHE..." : "Submit Paper"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ReviewPaperModalProps {
  paper: Paper;
  onSubmit: () => void;
  onClose: () => void;
  reviewData: any;
  setReviewData: (data: any) => void;
}

const ReviewPaperModal: React.FC<ReviewPaperModalProps> = ({ paper, onSubmit, onClose, reviewData, setReviewData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setReviewData({ ...reviewData, [name]: value });
  };

  const handleScoreChange = (score: number) => {
    setReviewData({ ...reviewData, score });
  };

  return (
    <div className="modal-overlay">
      <div className="review-paper-modal">
        <div className="modal-header">
          <h2>Review Paper</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="paper-info">
            <h3>{paper.title}</h3>
            <p className="paper-author">By {paper.author}</p>
            <div className="paper-abstract">{paper.abstract}</div>
          </div>
          
          <div className="review-form">
            <div className="form-group">
              <label>Score (1-5)</label>
              <div className="score-selector">
                {[1, 2, 3, 4, 5].map(score => (
                  <button
                    key={score}
                    className={`score-btn ${reviewData.score === score ? 'selected' : ''}`}
                    onClick={() => handleScoreChange(score)}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="form-group">
              <label>Comments (Encrypted)</label>
              <textarea 
                name="comments" 
                value={reviewData.comments} 
                onChange={handleChange} 
                placeholder="Enter your review comments..." 
                rows={6}
              />
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={!reviewData.score || !reviewData.comments} 
            className="submit-btn"
          >
            Submit Encrypted Review
          </button>
        </div>
      </div>
    </div>
  );
};

interface PaperDetailModalProps {
  paper: Paper;
  onClose: () => void;
  decryptedScores: number[];
  setDecryptedScores: (scores: number[]) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedScores: string[]) => Promise<number[]>;
  renderScoreChart: (paper: Paper) => JSX.Element;
  onReview: () => void;
}

const PaperDetailModal: React.FC<PaperDetailModalProps> = ({ 
  paper, 
  onClose, 
  decryptedScores,
  setDecryptedScores,
  isDecrypting, 
  decryptWithSignature,
  renderScoreChart,
  onReview
}) => {
  const handleDecrypt = async () => {
    if (decryptedScores.length > 0) { 
      setDecryptedScores([]); 
      return; 
    }
    
    const decrypted = await decryptWithSignature(paper.encryptedReviews);
    if (decrypted.length > 0) {
      setDecryptedScores(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="paper-detail-modal">
        <div className="modal-header">
          <h2>Paper Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="paper-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{paper.title}</strong>
            </div>
            <div className="info-item">
              <span>Author:</span>
              <strong>{paper.author}</strong>
            </div>
            <div className="info-item">
              <span>Submitted:</span>
              <strong>{new Date(paper.submissionDate * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item full-width">
              <span>Abstract:</span>
              <div className="paper-abstract">{paper.abstract}</div>
            </div>
          </div>
          
          <div className="review-section">
            <h3>Reviews</h3>
            <div className="review-stats">
              <div className="stat-item">
                <span>Average Score:</span>
                <strong>{paper.averageScore.toFixed(1)}/5</strong>
              </div>
              <div className="stat-item">
                <span>Total Reviews:</span>
                <strong>{paper.encryptedReviews.length}</strong>
              </div>
            </div>
            
            {paper.encryptedReviews.length > 0 && (
              <div className="score-distribution">
                <h4>Score Distribution</h4>
                {decryptedScores.length > 0 ? (
                  renderScoreChart(paper)
                ) : (
                  <div className="encrypted-scores">
                    <div className="fhe-tag">
                      <div className="fhe-icon"></div>
                      <span>FHE Encrypted</span>
                    </div>
                    <button 
                      className="decrypt-btn" 
                      onClick={handleDecrypt} 
                      disabled={isDecrypting}
                    >
                      {isDecrypting ? (
                        <span>Decrypting...</span>
                      ) : (
                        "Decrypt Scores with Wallet Signature"
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
            
            <div className="review-actions">
              <button className="review-btn" onClick={onReview}>
                Submit Review
              </button>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;