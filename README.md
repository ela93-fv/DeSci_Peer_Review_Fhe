# Decentralized Peer-Review System with Fully Homomorphic Encryption

This project is a Decentralized Peer-Review System designed to ensure fairness and integrity in the academic review process, powered by **Zama's Fully Homomorphic Encryption (FHE) technology**. By leveraging FHE, we can securely encrypt reviewers' identities and their feedback, enabling a truly double-blind review while protecting against conflicts of interest and academic bias.

## The Challenge in Academic Peer Review

The academic peer review system is often fraught with challenges, such as bias and conflicts of interest. Traditional review systems compromise the anonymity of reviewers, which can lead to unfair evaluations and deter honest feedback. As the academic community seeks to enhance the quality and credibility of research, the need for a transparent and fair review process has never been more critical.

## How FHE Addresses These Issues

Zama’s Fully Homomorphic Encryption technology offers a groundbreaking solution to these issues. By implementing FHE, we can encrypt sensitive data such as reviewers’ identities and their feedback, allowing computations to be performed on this encrypted data without ever exposing the underlying information. This is achieved using Zama's open-source libraries, including **Concrete** and **TFHE-rs**, ensuring the highest level of confidentiality in the review process.

Real-time computations on homomorphically encrypted data enhance transparency while safeguarding reviewer anonymity, ensuring fairness in the evaluation process while effectively mitigating bias.

## Core Features

- **Encrypted Reviewer Identity and Feedback:** Securely encrypts both the identities of reviewers and their evaluations, ensuring complete anonymity.
- **Homomorphic Aggregation:** Final scores and evaluations are computed while the feedback remains encrypted, protecting the integrity of the review process.
- **Enhanced Anonymity and Security:** Beyond encryption, the architecture promotes a secure environment for both reviewers and authors.
- **Workflow Management:** Streamlined submission and review processes, ensuring efficient management of the peer review cycle.

## Technology Stack

This project utilizes a robust technology stack, including:
- **Zama’s FHE SDK (Concrete)** for confidential computing.
- **Node.js** for runtime environment.
- **Hardhat/Foundry** for smart contract development and management.
- **Solidity** for Ethereum smart contracts.

## Directory Structure

Here's a quick overview of the project structure:

```
/DecSci_Peer_Review_Fhe
│
├── contracts
│   └── DeSci_Peer_Review.sol
│
├── src
│   ├── index.js
│   ├── utils.js
│   └── reviews.js
│
├── tests
│   └── review.test.js
│
├── package.json
└── README.md
```

## Installation Guide

To set up the project on your local machine, follow these steps:

1. **Download the Project:**
   Ensure you download the project files to your local system.

2. **Install Dependencies:**
   Navigate to the project directory in your terminal and run:
   ```bash
   npm install
   ```
   This command will automatically fetch Zama's FHE libraries and other necessary dependencies.

3. **Node.js and Hardhat/Foundry Setup:**
   Ensure you have **Node.js** and either **Hardhat** or **Foundry** installed. If they are not installed, you can download them from their respective official websites.

## Building and Running the Project

After properly setting up the project, you can compile, test, and run your contracts using the following commands:

### Compile the Smart Contracts
To compile the smart contracts, run:
```bash
npx hardhat compile
```

### Test the Smart Contracts
To execute unit tests and ensure everything is functioning as expected, run:
```bash
npx hardhat test
```

### Deploy the Smart Contracts
To deploy the smart contracts on your local blockchain (like Ganache), use:
```bash
npx hardhat run scripts/deploy.js --network localhost
```

## Example Code Snippet

Here is a simple example of how to submit a review within the application:

```javascript
const { ethers } = require("hardhat");

async function submitReview(reviewContent, reviewerId) {
    const ReviewContract = await ethers.getContractFactory("DeSci_Peer_Review");
    const reviewContract = await ReviewContract.deploy();
    await reviewContract.deployed();

    const encryptedReview = encryptReview(reviewContent); // Assume this function encrypts the content using FHE
    await reviewContract.submitReview(encryptedReview, reviewerId);
    console.log("Review submitted and securely encrypted!");
}
```

This code illustrates the submission of a review where the review content is encrypted before being sent to the blockchain.

## Acknowledgements

### Powered by Zama

A heartfelt thank you to the team at Zama for their pioneering work and commitment to open-source tools that empower the creation of confidential blockchain applications. Your dedication to advancing the field of cryptography is the backbone of this project and many others.

---

This README aims to provide a comprehensive overview of the Decentralized Peer-Review System, illustrating the potential and utility of combining academic integrity with cutting-edge technology. For developers looking to contribute or enhance this project, your engagement is invaluable!
