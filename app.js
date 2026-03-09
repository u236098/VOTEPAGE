const connectWalletBtn = document.getElementById("connectWalletBtn");
const loadElectionBtn = document.getElementById("loadElectionBtn");
const encryptVoteBtn = document.getElementById("encryptVoteBtn");
const submitVoteBtn = document.getElementById("submitVoteBtn");

const accountSpan = document.getElementById("account");

// ===== CONFIG =====
const CONTRACT_ADDRESS = "0x83aD9FE67880579b29038689902dacFDf39945E4";
const PUBLIC_KEY_URL = "public_key.json";
// ==================

const electionTitleSpan = document.getElementById("electionTitle");
const electionStatusSpan = document.getElementById("electionStatus");
const timeRemainingSpan = document.getElementById("timeRemaining");
const candidateListDiv = document.getElementById("candidateList");

const voteChoiceInput = document.getElementById("voteChoice");
const encryptedVoteOutput = document.getElementById("encryptedVoteOutput");
const messagesDiv = document.getElementById("messages");

const viewResultsBtn = document.getElementById("viewResultsBtn");
const resultsCard = document.getElementById("resultsCard");
const winnerNameSpan = document.getElementById("winnerName");
const resultsListDiv = document.getElementById("resultsList");
const resultsMessage = document.getElementById("resultsMessage");

let provider = null;
let signer = null;
let userAccount = null;
let contract = null;
let publicKey = null;
let candidates = [];

// Replace this ABI later if you change the Solidity contract.
const contractABI = [
  "function electionTitle() view returns (string)",
  "function getCandidates() view returns (tuple(string name,uint256 voteCount)[])",
  "function getElectionStatus() view returns (string)",
  "function timeRemaining() view returns (uint256)",
  "function votingEnd() view returns (uint256)",
  "function resultsPublished() view returns (bool)",
  "function getWinner() view returns (string)",
  "function vote(bytes _encryptedVote)",
  "function hasVoted(address) view returns (bool)",
  "function isApprovedVoter(address) view returns (bool)"
];

function addMessage(message, type = "info") {
  const p = document.createElement("p");
  p.textContent = message;
  p.className = type;
  messagesDiv.prepend(p);
}

function clearMessages() {
  messagesDiv.innerHTML = "";
}

function bytesToHex(bytesArray) {
  return "0x" + bytesArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function numberToBytes(n) {
  const hex = n.toString(16).padStart(2, "0");
  return "0x" + hex;
}

// Fast modular exponentiation using BigInt
function modPow(base, exponent, modulus) {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = base % modulus;
  let e = exponent;

  while (e > 0n) {
    if (e % 2n === 1n) {
      result = (result * b) % modulus;
    }
    e = e / 2n;
    b = (b * b) % modulus;
  }

  return result;
}

// ElGamal encryption for a small integer message m
// ciphertext = (c1, c2) where:
// c1 = g^k mod p
// c2 = m * y^k mod p
function elgamalEncrypt(message, pk) {
  const p = BigInt(pk.p);
  const g = BigInt(pk.g);
  const y = BigInt(pk.y);
  const m = BigInt(message);

  if (m <= 0n || m >= p) {
    throw new Error("Vote choice must be greater than 0 and less than p");
  }

  // Random k in [1, p-2]
  const maxK = Number(p - 2n);
  const k = BigInt(Math.floor(Math.random() * maxK) + 1);

  const c1 = modPow(g, k, p);
  const c2 = (m * modPow(y, k, p)) % p;

  return { c1, c2 };
}

// Encode ciphertext as bytes:
// "c1:c2" -> UTF-8 bytes -> hex string
function ciphertextToHex(ciphertext) {
  const text = `${ciphertext.c1.toString()}:${ciphertext.c2.toString()}`;
  const encoder = new TextEncoder();
  const bytes = Array.from(encoder.encode(text));
  return bytesToHex(bytes);
}

async function connectWallet() {
  try {

    if (!window.ethereum) {
      addMessage("MetaMask not detected", "error");
      return;
    }

    provider = new ethers.BrowserProvider(window.ethereum);

    await provider.send("eth_requestAccounts", []);

    signer = await provider.getSigner();
    userAccount = await signer.getAddress();

    const network = await provider.getNetwork();

    console.log("Connected chain:", network.chainId);

    if (network.chainId !== 11155111n) {
      addMessage("Please switch MetaMask to Sepolia network.", "error");
      return;
    }

    accountSpan.textContent = userAccount;

    addMessage("Wallet connected on Sepolia.", "success");

  } catch (error) {
    addMessage(error.message, "error");
  }
}

function renderCandidates() {
  candidateListDiv.innerHTML = "";
  const voteOptionsDiv = document.getElementById("voteOptions");
  voteOptionsDiv.innerHTML = "";

  if (candidates.length === 0) {
    candidateListDiv.innerHTML = "<p>No candidates loaded.</p>";
    return;
  }

  const ul = document.createElement("ul");
  const ul2 = document.createElement("ul");

  candidates.forEach((candidate, index) => {
    const li = document.createElement("li");
    li.textContent = `${index + 1} = ${candidate.name}`;
    ul.appendChild(li);

    const li2 = document.createElement("li");
    li2.textContent = `${index + 1} = ${candidate.name}`;
    ul2.appendChild(li2);
  });

  candidateListDiv.appendChild(ul);
  voteOptionsDiv.appendChild(ul2);
}

async function loadPublicKey() {
  const response = await fetch(PUBLIC_KEY_URL);
  publicKey = await response.json();
  addMessage("Public key loaded automatically.", "success");
}

async function loadElection() {
  try {
    clearMessages();

    if (!signer) {
      addMessage("Please connect MetaMask first.", "error");
      return;
    }

    await loadPublicKey();

    contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, signer);

    // Check that contract actually exists at this address
    const network = await provider.getNetwork();
    const code = await provider.getCode(CONTRACT_ADDRESS);
    addMessage(`Network: ${network.name} (Chain ID: ${network.chainId})`, "info");

    if (code === "0x") {
      addMessage("No contract found at this address on the current network!", "error");
      addMessage("Make sure you deployed using 'Injected Provider - MetaMask' in Remix (not Remix VM).", "error");
      addMessage("Also make sure MetaMask is on the same network you deployed to.", "error");
      return;
    }

    const title = await contract.electionTitle();
    const status = await contract.getElectionStatus();
    const remaining = await contract.timeRemaining();
    const loadedCandidates = await contract.getCandidates();

    electionTitleSpan.textContent = title;
    electionStatusSpan.textContent = status;
    timeRemainingSpan.textContent = `${remaining.toString()} seconds`;

    candidates = loadedCandidates.map(c => ({
      name: c.name,
      voteCount: c.voteCount.toString()
    }));

    renderCandidates();

    const approved = await contract.isApprovedVoter(userAccount);
    const voted = await contract.hasVoted(userAccount);

    addMessage(`Election loaded: ${title}`, "success");
    addMessage(`Approved voter: ${approved}`, "info");
    addMessage(`Already voted: ${voted}`, "info");
  } catch (error) {
    addMessage(`Failed to load election: ${error.message}`, "error");
  }
}

function encryptVoteChoice() {
  try {
    clearMessages();

    if (!publicKey) {
      addMessage("Public key not loaded.", "error");
      return;
    }

    if (candidates.length === 0) {
      addMessage("Load election first.", "error");
      return;
    }

    const choice = Number(voteChoiceInput.value);

    if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) {
      addMessage(`Enter a valid candidate number between 1 and ${candidates.length}.`, "error");
      return;
    }

    const ciphertext = elgamalEncrypt(choice, publicKey);
    const hexCiphertext = ciphertextToHex(ciphertext);

    encryptedVoteOutput.value = hexCiphertext;

    addMessage(`Vote encrypted successfully for candidate #${choice}.`, "success");
    addMessage(`Ciphertext: ${hexCiphertext}`, "info");
  } catch (error) {
    addMessage(`Encryption failed: ${error.message}`, "error");
  }
}

async function submitVote() {
  try {
    clearMessages();

    if (!contract) {
      addMessage("Load election first.", "error");
      return;
    }

    const encryptedVoteHex = encryptedVoteOutput.value.trim();

    if (!encryptedVoteHex || !encryptedVoteHex.startsWith("0x")) {
      addMessage("Please encrypt a vote first.", "error");
      return;
    }

    const voted = await contract.hasVoted(userAccount);
    if (voted) {
      addMessage("This wallet has already voted.", "error");
      return;
    }

    const tx = await contract.vote(encryptedVoteHex);
    addMessage(`Transaction sent: ${tx.hash}`, "info");

    await tx.wait();

    addMessage("Vote submitted successfully.", "success");

    const status = await contract.getElectionStatus();
    const remaining = await contract.timeRemaining();

    electionStatusSpan.textContent = status;
    timeRemainingSpan.textContent = `${remaining.toString()} seconds`;
  } catch (error) {
    addMessage(`Vote submission failed: ${error.message}`, "error");
  }
}

connectWalletBtn.addEventListener("click", connectWallet);
loadElectionBtn.addEventListener("click", loadElection);
encryptVoteBtn.addEventListener("click", encryptVoteChoice);
submitVoteBtn.addEventListener("click", submitVote);
viewResultsBtn.addEventListener("click", viewResults);

async function viewResults() {
  try {
    resultsMessage.textContent = "";

    if (!contract) {
      resultsMessage.textContent = "Please load the election first.";
      return;
    }

    const remaining = await contract.timeRemaining();

    if (remaining > 0n) {
      resultsMessage.textContent = `Voting is still active. ${remaining.toString()} seconds remaining.`;
      resultsCard.style.display = "none";
      return;
    }

    const published = await contract.resultsPublished();

    if (!published) {
      resultsMessage.textContent = "Voting has ended but results have not been published yet.";
      resultsCard.style.display = "none";
      return;
    }

    const winner = await contract.getWinner();
    const finalCandidates = await contract.getCandidates();

    winnerNameSpan.textContent = winner;

    resultsListDiv.innerHTML = "";
    const ul = document.createElement("ul");

    finalCandidates.forEach((c, index) => {
      const li = document.createElement("li");
      li.textContent = `${index + 1}. ${c.name}: ${c.voteCount.toString()} votes`;
      ul.appendChild(li);
    });

    resultsListDiv.appendChild(ul);
    resultsCard.style.display = "block";
    resultsMessage.textContent = "";

  } catch (error) {
    resultsMessage.textContent = `Error: ${error.message}`;
  }
}
