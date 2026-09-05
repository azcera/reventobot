const path = require("path");

const ROOT_PATH = path.join(__dirname, "..", "..");

module.exports = {
    ROOT_PATH,
    IMAGES_PATH: path.join(ROOT_PATH, "src", "images"),
    PUBLIC_PATH: path.join(ROOT_PATH, "public"),
};
