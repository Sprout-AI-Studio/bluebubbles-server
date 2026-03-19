import React, { useEffect, useState } from 'react';
import {
    FormControl,
    FormLabel,
    FormHelperText,
    Input,
    IconButton,
    FormErrorMessage,
    Text
} from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { showSuccessToast } from '../../utils/ToastUtils';
import { setConfig } from '../../slices/ConfigSlice';
import { AiOutlineSave } from 'react-icons/ai';

export const SlackChannelField = (): JSX.Element => {
    const dispatch = useAppDispatch();
    const channel: string = (useAppSelector(state => state.config.slack_channel) ?? '');
    const [newChannel, setNewChannel] = useState(channel);
    const [error, setError] = useState('');
    const hasError: boolean = (error ?? '').length > 0;

    useEffect(() => { setNewChannel(channel); }, [channel]);

    const saveChannel = (val: string): void => {
        val = val.trim();
        if (val === channel) {
            setError('You have not changed the channel since your last save!');
            return;
        }

        dispatch(setConfig({ name: 'slack_channel', value: val }));
        setError('');
        showSuccessToast({
            id: 'settings',
            duration: 4000,
            description: 'Successfully saved Slack channel!'
        });
    };

    return (
        <FormControl isInvalid={hasError}>
            <FormLabel htmlFor='slack_channel'>Slack Channel (Optional)</FormLabel>
            <Input
                id='slack_channel'
                type='text'
                maxWidth="20em"
                placeholder='#bluebubbles-alerts'
                value={newChannel}
                onChange={(e) => {
                    if (hasError) setError('');
                    setNewChannel(e.target.value);
                }}
            />
            <IconButton
                ml={3}
                verticalAlign='top'
                aria-label='Save Slack channel'
                icon={<AiOutlineSave />}
                onClick={() => saveChannel(newChannel)}
            />
            {!hasError ? (
                <FormHelperText>
                    <Text>
                        Override the default channel configured in the webhook.
                        Leave empty to use the webhook's default channel.
                    </Text>
                </FormHelperText>
            ) : (
                <FormErrorMessage>{error}</FormErrorMessage>
            )}
        </FormControl>
    );
};
