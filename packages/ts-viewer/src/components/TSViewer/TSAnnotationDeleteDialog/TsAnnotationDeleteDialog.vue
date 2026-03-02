<template>
  <el-dialog
    class="simple"
    :modelValue="visible"
    @update:modelValue="visible = $event"
    @close="close"
    @closed="onClosed"
  >
    <bf-dialog-header slot="title" />
    <dialog-body>
      <icon-warning-circle
          class="mb-16"
          :height="32"
          :width="32"
          color="#C14D49"
        />
      <h2>Delete annotation?</h2>
      <div class="dialog-simple-buttons">
        <bf-library-button
          class="secondary"
          @click="close"
        >
          Cancel
        </bf-library-button>
        <bf-library-button
          class="red"
          :processing="isProcessing"
          @click="removeAnnotation"
        >
          Delete
        </bf-library-button>
      </div>
    </dialog-body>
  </el-dialog>
</template>

<script>
import {
  pathOr, propOr
} from 'ramda'

import BfDialogHeader from '@/components/shared/bf-dialog-header/BfDialogHeader.vue'
import DialogBody from '@/components/shared/dialog-body/DialogBody.vue'
import BfLibraryButton from '@/components/shared/bf-library-button/BfLibraryButton.vue'
import IconWarningCircle from '@/components/icons/IconWarningCircle.vue'

export default {
  name: 'TsAnnotationDeleteDialog',

  components: {
    BfDialogHeader,
    DialogBody,
    BfLibraryButton,
    IconWarningCircle
  },

  props: {
    visible: {
      type: Boolean,
      default: false
    },
    deleteAnnotation: {
      type: Object,
      default: () => ({})
    }
  },

  data: function () {
    return {
      isProcessing: false
    }
  },

  methods: {
    removeAnnotation: function() {
      this.$emit('delete', this.deleteAnnotation)
    },
    /**
     * Emit event to update the synced property
     */
    close: function() {
      this.$emit('update:visible', false)
    },

    /**
     * Callback after the dialog has closed
     * Reset dialog
     */
    onClosed: function() {
      this.isProcessing = false
      this.$emit('update:delete-annotation', {})
    },
    getUTCDateString: function(d) {
      if(d > 0) {
        d = new Date(d/1000);
        return ( d.toDateString() );
      } else {
        return 'unknown';
      }
    },
    getUTCTimeString: function(d) {
      if(d > 0) {
        d = d / 1000;
        d = new Date(d);
        return ( ('0' + d.getUTCHours()).slice(-2) + ':' +
          ('0' + d.getUTCMinutes()).slice(-2) + ':' + ('0' + d.getUTCSeconds()).slice(-2) );
      }
    }
  }
}
</script>

<style lang="scss" scoped>
@import '../../../assets/tsviewerVariables.scss';

.mb-16 {
  color: $red_1
}

.dialog-simple-buttons {
  display: flex;
  margin-top: 16px;
  justify-content: center;
  .bf-library-button {
    margin-left: 8px;
  }
}

h2 {
  color: #000;
  font-size: 14px;
  list-style: 16px;
  margin: 0 0 8px;
}
</style>
