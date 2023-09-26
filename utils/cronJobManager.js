const jobs = [[]];

module.exports = {
	// Add a new job to the list
	addJob: function(jobId, job) {
		jobs.push([jobId, job]);
	},

	// Get all jobs
	getAllJobs: function() {
		return jobs;
	},

	// Stop a single job
	stopJob: function(jobId) {
		const job = jobs.find(row => row.some(id => id === jobId))[1];
		job.stop();
	},

	// Stop all jobs
	stopAllJobs: function() {
		for (const job of jobs) {
			job.stop();
		}
	},
};
