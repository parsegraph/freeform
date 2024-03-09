import { deserializeParsegraph } from "parsegraph";

const generatePrimes = (setProgress) => {
  const worker = new Worker("primes.js");
  let jobs = new Map();
  worker.onmessage = (e) => {
    const job = jobs.get(e.data.key);
    if (!job) {
      throw new Error("Orphaned job");
    }
    if (typeof e.data.progress === "number") {
      setProgress(e.data.progress);
      return;
    }
    jobs.delete(e.data.key);
    try {
      const graph = deserializeParsegraph(e.data.graph);
      job[0](graph);
    } catch (ex) {
      jobs[1](ex);
    }
  };
  return (numSteps) => {
    const key = Math.random() + "-" + Date.now();
    return new Promise((resolve, reject) => {
      jobs.set(key, [resolve, reject]);
      worker.postMessage({numSteps, key});
    });
  };
};

export {
  generatePrimes
}