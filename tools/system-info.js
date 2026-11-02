const os = require("os");

module.exports = {
  name: "system_info",

  declaration: {
    name: "system_info",
    description:
      "Return current system information including operating system, platform, architecture, hostname, CPU count, memory, uptime, and Node.js version.",
    parameters: {
      type: "object",
      properties: {}
    }
  },

  execute: async () => {
    const totalMemoryGB = (
      os.totalmem() /
      1024 /
      1024 /
      1024
    ).toFixed(2);

    const freeMemoryGB = (
      os.freemem() /
      1024 /
      1024 /
      1024
    ).toFixed(2);

    const uptimeMinutes = (
      os.uptime() /
      60
    ).toFixed(0);

    return JSON.stringify(
      {
        operatingSystem: os.type(),
        platform: os.platform(),
        architecture: os.arch(),
        hostname: os.hostname(),
        cpuCount: os.cpus().length,
        totalMemoryGB,
        freeMemoryGB,
        uptimeMinutes,
        nodeVersion: process.version
      },
      null,
      2
    );
  }
};
