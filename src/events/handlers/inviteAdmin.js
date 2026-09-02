const inviteButtonHandler = require("./invite/inviteButtonHandler");
const inviteModalHandler = require("./invite/inviteModalHandler");
const inviteVoiceSelectHandler = require("./invite/inviteVoiceSelectHandler");

class InviteAdmin {
    async handleButtons(interaction) {
        return inviteButtonHandler(interaction);
    }

    async submitRejectModal(interaction) {
        return inviteModalHandler(interaction);
    }

    async handleVoiceSelect(interaction) {
        return inviteVoiceSelectHandler(interaction);
    }
}

module.exports = new InviteAdmin();